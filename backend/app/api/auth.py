from datetime import UTC, datetime, timedelta

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.config import COOKIE_SECURE, REFRESH_COOKIE_NAME, REFRESH_TOKEN_EXPIRE_DAYS
from app.core.exceptions import NotFoundError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.crud.auth import (
    approve_teacher,
    create_pending_teacher,
    get_teacher_by_email,
    get_valid_refresh_token,
    list_pending_teachers,
    reject_teacher,
    revoke_refresh_token,
    store_refresh_token,
)
from app.db.session import get_session
from app.models.enums import TeacherStatus
from app.models.teacher import Teacher
from app.schemas.auth import (
    CurrentUser,
    LoginRequest,
    PendingTeacherRead,
    RegisterRequest,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_endpoint(
    data: RegisterRequest,
    db: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    try:
        await create_pending_teacher(db, data)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        ) from None
    return {"message": "Registration received, pending admin approval"}


@router.get("/pending", response_model=list[PendingTeacherRead])
async def list_pending_endpoint(
    db: AsyncSession = Depends(get_session),
    admin: CurrentUser = Depends(require_admin),
) -> list[PendingTeacherRead]:
    teachers = await list_pending_teachers(db)
    return [PendingTeacherRead.model_validate(t) for t in teachers]


@router.post("/approve/{teacher_id}", response_model=PendingTeacherRead)
async def approve_endpoint(
    teacher_id: int,
    db: AsyncSession = Depends(get_session),
    admin: CurrentUser = Depends(require_admin),
) -> PendingTeacherRead:
    try:
        teacher = await approve_teacher(db, teacher_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return PendingTeacherRead.model_validate(teacher)


@router.post("/reject/{teacher_id}", response_model=PendingTeacherRead)
async def reject_endpoint(
    teacher_id: int,
    db: AsyncSession = Depends(get_session),
    admin: CurrentUser = Depends(require_admin),
) -> PendingTeacherRead:
    try:
        teacher = await reject_teacher(db, teacher_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return PendingTeacherRead.model_validate(teacher)


@router.post("/login", response_model=TokenResponse)
async def login_endpoint(
    data: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_session),
) -> TokenResponse:
    teacher = await get_teacher_by_email(db, str(data.email))
    if teacher is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not await verify_password(data.password, teacher.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if teacher.status == TeacherStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account pending admin approval",
        )
    if teacher.status == TeacherStatus.REJECTED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration request was rejected",
        )
    if teacher.status != TeacherStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not active",
        )

    access_token = create_access_token(teacher.id, str(teacher.role.value))
    raw_refresh = create_refresh_token(teacher.id)
    jti = decode_token(raw_refresh)["jti"]
    expires_at_naive = (datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)).replace(
        tzinfo=None
    )
    await store_refresh_token(db, teacher.id, jti, expires_at_naive)

    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_refresh,
        httponly=True,
        secure=False,  # Must be False for localhost http://
        samesite="lax",  # Crucial for localhost cross-port requests
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/",
    )
    return TokenResponse(access_token=access_token, token_type="bearer")


@router.post("/refresh", response_model=TokenResponse)
async def refresh_endpoint(
    response: Response,
    refresh_token: str | None = Cookie(None, alias=REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_session),
) -> TokenResponse:
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    try:
        payload = decode_token(refresh_token)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        ) from None

    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    jti = payload.get("jti")
    if jti is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    row = await get_valid_refresh_token(db, jti)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    await revoke_refresh_token(db, jti)

    stmt = select(Teacher).where(Teacher.id == row.teacher_id)
    result = await db.execute(stmt)
    teacher = result.scalar_one_or_none()
    if teacher is None or teacher.status != TeacherStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    access_token = create_access_token(teacher.id, str(teacher.role.value))
    new_raw = create_refresh_token(teacher.id)
    new_jti = decode_token(new_raw)["jti"]
    new_expires_naive = (datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)).replace(
        tzinfo=None
    )
    await store_refresh_token(db, teacher.id, new_jti, new_expires_naive)

    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=new_raw,
        httponly=True,
        secure=False,  # Must be False for localhost http://
        samesite="lax",  # Crucial for localhost cross-port requests
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/",
    )
    return TokenResponse(access_token=access_token, token_type="bearer")


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout_endpoint(
    response: Response,
    refresh_token: str | None = Cookie(None, alias=REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_session),
) -> None:
    if refresh_token:
        try:
            payload = decode_token(refresh_token)
            if payload.get("type") == "refresh" and payload.get("jti"):
                await revoke_refresh_token(db, payload["jti"])
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            pass
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/")
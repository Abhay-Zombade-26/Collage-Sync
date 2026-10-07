from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user, require_admin
from app.core.exceptions import NotFoundError
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    verify_password,
)
from app.crud.auth import (
    create_pending_teacher,
    create_refresh_token_row,
    get_refresh_token_row,
    get_teacher_by_email,
    revoke_refresh_token_row,
    update_teacher_status,
)
from app.db.session import get_session
from app.models.enums import TeacherStatus
from app.models.teacher import Teacher
from app.schemas.auth import (
    LoginRequest,
    MeRead,
    RegisterRequest,
    RegistrationRead,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=RegistrationRead, status_code=status.HTTP_201_CREATED)
async def register_endpoint(
    data: RegisterRequest,
    db: AsyncSession = Depends(get_session),
) -> RegistrationRead:
    try:
        teacher = await create_pending_teacher(db, data)
        return RegistrationRead.model_validate(teacher)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        ) from exc


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
            detail="Invalid credentials",
        )

    if not await verify_password(data.password, teacher.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
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

    access_token = create_access_token(teacher.id)
    raw_refresh, token_hash = generate_refresh_token()
    expires_at = (datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)).replace(
        tzinfo=None
    )
    await create_refresh_token_row(db, teacher.id, token_hash, expires_at)

    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=raw_refresh,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/",
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_endpoint(
    response: Response,
    refresh_token: str | None = Cookie(None, alias=settings.REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_session),
) -> TokenResponse:
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    token_hash = hash_refresh_token(refresh_token)
    row = await get_refresh_token_row(db, token_hash)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    stmt = select(Teacher).where(Teacher.id == row.teacher_id)
    result = await db.execute(stmt)
    teacher = result.scalar_one_or_none()
    if teacher is None or teacher.status != TeacherStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    await revoke_refresh_token_row(db, token_hash)
    new_raw, new_hash = generate_refresh_token()
    new_expires_at = (
        datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    ).replace(tzinfo=None)
    await create_refresh_token_row(db, teacher.id, new_hash, new_expires_at)

    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=new_raw,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="strict",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/",
    )

    return TokenResponse(
        access_token=create_access_token(teacher.id),
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout_endpoint(
    response: Response,
    current_user: Teacher = Depends(get_current_user),
    refresh_token: str | None = Cookie(None, alias=settings.REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_session),
) -> None:
    if refresh_token:
        token_hash = hash_refresh_token(refresh_token)
        await revoke_refresh_token_row(db, token_hash)
    response.delete_cookie(key=settings.REFRESH_COOKIE_NAME, path="/")


@router.get("/me", response_model=MeRead)
async def me_endpoint(
    current_user: Teacher = Depends(get_current_user),
) -> MeRead:
    return MeRead.model_validate(current_user)


@router.get("/registrations", response_model=list[RegistrationRead])
async def list_registrations_endpoint(
    admin: Teacher = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
) -> list[RegistrationRead]:
    stmt = (
        select(Teacher)
        .where(Teacher.status == TeacherStatus.PENDING)
        .order_by(Teacher.created_at.asc())
    )
    result = await db.execute(stmt)
    teachers = result.scalars().all()
    return [RegistrationRead.model_validate(t) for t in teachers]


@router.post(
    "/registrations/{teacher_id}/approve",
    response_model=RegistrationRead,
)
async def approve_registration_endpoint(
    teacher_id: int,
    admin: Teacher = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
) -> RegistrationRead:
    try:
        teacher = await update_teacher_status(db, teacher_id, TeacherStatus.ACTIVE)
        return RegistrationRead.model_validate(teacher)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.post(
    "/registrations/{teacher_id}/reject",
    response_model=RegistrationRead,
)
async def reject_registration_endpoint(
    teacher_id: int,
    admin: Teacher = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
) -> RegistrationRead:
    try:
        teacher = await update_teacher_status(db, teacher_id, TeacherStatus.REJECTED)
        return RegistrationRead.model_validate(teacher)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

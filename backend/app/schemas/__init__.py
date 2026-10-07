from app.schemas.auth import (
    LoginRequest,
    MeRead,
    RegisterRequest,
    RegistrationRead,
    TokenResponse,
)
from app.schemas.batch import (
    BatchBase,
    BatchCreate,
    BatchRead,
    BatchUpdate,
)
from app.schemas.division import (
    DivisionBase,
    DivisionCreate,
    DivisionRead,
    DivisionUpdate,
)
from app.schemas.room import (
    RoomBase,
    RoomCreate,
    RoomRead,
    RoomUpdate,
)
from app.schemas.subject import (
    SubjectBase,
    SubjectCreate,
    SubjectRead,
    SubjectUpdate,
)
from app.schemas.teacher import (
    TeacherBase,
    TeacherCreate,
    TeacherRead,
    TeacherUpdate,
)

__all__ = [
    "BatchBase",
    "BatchCreate",
    "BatchRead",
    "BatchUpdate",
    "DivisionBase",
    "DivisionCreate",
    "DivisionRead",
    "DivisionUpdate",
    "LoginRequest",
    "MeRead",
    "RegisterRequest",
    "RegistrationRead",
    "RoomBase",
    "RoomCreate",
    "RoomRead",
    "RoomUpdate",
    "SubjectBase",
    "SubjectCreate",
    "SubjectRead",
    "SubjectUpdate",
    "TeacherBase",
    "TeacherCreate",
    "TeacherRead",
    "TeacherUpdate",
    "TokenResponse",
]

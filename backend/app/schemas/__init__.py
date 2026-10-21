from app.schemas.auth import (
    CurrentUser,
    LoginRequest,
    PendingTeacherRead,
    RegisterRequest,
    TokenResponse,
)
from app.schemas.batch import (
    BatchBase,
    BatchCreate,
    BatchRead,
    BatchUpdate,
)
from app.schemas.branch import (
    BranchBase,
    BranchCreate,
    BranchRead,
    BranchUpdate,
)
from app.schemas.division import (
    DivisionBase,
    DivisionCreate,
    DivisionRead,
    DivisionUpdate,
)
from app.schemas.eligibility import (
    EligibilityCreate,
    EligibilityRead,
    EligibilityUpdate,
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
from app.schemas.timetable import (
    GenerateRequest,
    SlotUpdate,
    TimetableSlotRead,
)
from app.schemas.timetable_settings import (
    TimetableSettingsCreate,
    TimetableSettingsRead,
    TimetableSettingsUpdate,
)
from app.schemas.weekly_requirement import (
    WeeklyRequirementCreate,
    WeeklyRequirementRead,
    WeeklyRequirementUpdate,
)

__all__ = [
    "BatchBase",
    "BatchCreate",
    "BatchRead",
    "BatchUpdate",
    "BranchBase",
    "BranchCreate",
    "BranchRead",
    "BranchUpdate",
    "CurrentUser",
    "DivisionBase",
    "DivisionCreate",
    "DivisionRead",
    "DivisionUpdate",
    "EligibilityCreate",
    "EligibilityRead",
    "EligibilityUpdate",
    "GenerateRequest",
    "LoginRequest",
    "PendingTeacherRead",
    "RegisterRequest",
    "RoomBase",
    "RoomCreate",
    "RoomRead",
    "RoomUpdate",
    "SlotUpdate",
    "SubjectBase",
    "SubjectCreate",
    "SubjectRead",
    "SubjectUpdate",
    "TeacherBase",
    "TeacherCreate",
    "TeacherRead",
    "TeacherUpdate",
    "TimetableSettingsCreate",
    "TimetableSettingsRead",
    "TimetableSettingsUpdate",
    "TimetableSlotRead",
    "TokenResponse",
    "WeeklyRequirementCreate",
    "WeeklyRequirementRead",
    "WeeklyRequirementUpdate",
]

import enum


class TeacherRole(str, enum.Enum):
    ADMIN = "ADMIN"
    TEACHER = "TEACHER"


class TeacherStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    PENDING = "PENDING"


class EmploymentType(str, enum.Enum):
    REGULAR = "REGULAR"
    VISITING = "VISITING"


class RoomType(str, enum.Enum):
    LECTURE = "LECTURE"
    LAB = "LAB"


class DayOfWeek(str, enum.Enum):
    MONDAY = "MONDAY"
    TUESDAY = "TUESDAY"
    WEDNESDAY = "WEDNESDAY"
    THURSDAY = "THURSDAY"
    FRIDAY = "FRIDAY"

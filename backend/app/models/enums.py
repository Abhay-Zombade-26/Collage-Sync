import enum


class TeacherRole(enum.StrEnum):
    ADMIN = "ADMIN"
    TEACHER = "TEACHER"


class TeacherStatus(enum.StrEnum):
    ACTIVE = "ACTIVE"
    PENDING = "PENDING"


class EmploymentType(enum.StrEnum):
    REGULAR = "REGULAR"
    VISITING = "VISITING"


class RoomType(enum.StrEnum):
    LECTURE = "LECTURE"
    LAB = "LAB"


class DayOfWeek(enum.StrEnum):
    MONDAY = "MONDAY"
    TUESDAY = "TUESDAY"
    WEDNESDAY = "WEDNESDAY"
    THURSDAY = "THURSDAY"
    FRIDAY = "FRIDAY"

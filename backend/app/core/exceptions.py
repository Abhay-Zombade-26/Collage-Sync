class NotFoundError(Exception):
    def __init__(self, entity: str, identifier: int | str):
        self.entity = entity
        self.identifier = identifier
        super().__init__(f"{entity} with id {identifier} not found")

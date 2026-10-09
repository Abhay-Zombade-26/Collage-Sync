/**
 * API Client Stub
 *
 * NOTE: The backend OpenAPI spec / endpoint is not connected yet.
 * Once the openapi.json spec is provided, this file will be swapped for the
 * generated TypeScript client (openapi-typescript / orval).
 *
 * Raw fetch and axios are banned by ESLint (see eslint.config.js).
 */

export interface DivisionDTO {
  id: number;
  department: string;
  year: string;
  name: string;
  semester: number;
  created_at?: string;
}

export interface DivisionCreateInput {
  name: string;
  department: string;
  year: string;
  semester: number;
}

export class BackendNotConnectedError extends Error {
  constructor(message = 'Backend not connected yet. Awaiting OpenAPI spec connection.') {
    super(message);
    this.name = 'BackendNotConnectedError';
  }
}

export const apiClient = {
  divisions: {
    list: async (): Promise<DivisionDTO[]> => {
      // Pending backend OpenAPI connection
      throw new BackendNotConnectedError();
    },
    create: async (_data: DivisionCreateInput): Promise<DivisionDTO> => {
      // Pending backend OpenAPI connection
      throw new BackendNotConnectedError();
    },
  },
};

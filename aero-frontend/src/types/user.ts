export type Role = 'admin' | 'user';

export interface User {
  id: string;
  email: string;
  role: Role;
  permissions?: string[];
}

export type Role = "Staff" | "IT Admin" | "System Admin" | "Viewer";

export interface TeamMember {
  userId: number;
  fullName: string;
  nickname: string;
  email: string;
  appRole: Role;
  position: string;
  color: string;
  photo: string | null;
  isActive: boolean;
}

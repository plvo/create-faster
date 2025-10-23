import type { auth } from './auth';

export type Session = typeof auth.$Infer.Session;
export type UserSession = typeof auth.$Infer.Session.user;

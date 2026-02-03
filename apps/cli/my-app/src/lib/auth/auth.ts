import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const auth = betterAuth({
  plugins: [nextCookies()],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    revokeSessionsOnPasswordReset: true,
  },
  // verbose for explicitly setting the model name
  user: {
    modelName: 'user',
    fields: {
      name: 'username',
      email: 'email',
      emailVerified: 'emailVerified',
      image: 'avatarUrl',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  session: {
    modelName: 'session',
    fields: {
      userId: 'userId',
      token: 'token',
      expiresAt: 'expiresAt',
      ipAddress: 'ipAddress',
      userAgent: 'userAgent',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    expiresIn: 15 * DAY,
  },
  account: {
    modelName: 'account',
    fields: {
      userId: 'userId',
      accountId: 'accountId',
      providerId: 'providerId',
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
      accessTokenExpiresAt: 'accessTokenExpiresAt',
      refreshTokenExpiresAt: 'refreshTokenExpiresAt',
      scope: 'scope',
      idToken: 'idToken',
      password: 'password',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  verification: {
    modelName: 'verification',
    fields: {
      identifier: 'identifier',
      value: 'value',
      expiresAt: 'expiresAt',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
});

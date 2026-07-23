import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

// 生成JWT token
export async function generateToken(): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const token = await new SignJWT({ authorized: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
  return token;
}

// 验证JWT token
export async function verifyToken(token: string): Promise<boolean> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload.authorized === true;
  } catch {
    return false;
  }
}

// 验证API Key
export function validateApiKey(apiKey: string): boolean {
  const validKey = process.env.AUTH_SECRET || 'notai2024secret';
  return apiKey === validKey;
}

import { Router, Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma';

export const authRouter = Router();
const googleClient = new OAuth2Client(config.googleClientId);

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
  };
}

/**
 * Middleware to authenticate requests using JWT tokens
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, config.jwtSecret, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session' });
    }
    req.user = decoded as { id: number; email: string };
    next();
  });
}

/**
 * Endpoint: POST /api/auth/google
 * Body: { idToken: string }
 */
authRouter.post('/google', async (req: Request, res: Response) => {
  const { idToken } = req.body;
  
  if (!idToken) {
    return res.status(400).json({ error: 'ID token is required' });
  }
  
  try {
    let email: string;
    let name: string;
    let avatar: string | undefined;
    let googleId: string;

    if (!config.googleClientId) {
      return res.status(500).json({ error: 'Google Client ID is not configured on the server.' });
    }

    // Real Google OAuth verification
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.googleClientId,
    });
    const payload = ticket.getPayload();
    
    if (!payload || !payload.email || !payload.sub || !payload.name) {
      return res.status(400).json({ error: 'Invalid ID token payload' });
    }
    
    email = payload.email;
    name = payload.name;
    avatar = payload.picture;
    googleId = payload.sub;
    
    // Find or create user in MySQL
    let user = await prisma.user.findUnique({
      where: { googleId },
    });
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name,
          avatar,
          googleId,
        },
      });
    } else if (user.name !== name || user.avatar !== avatar) {
      // Update details if they changed
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name, avatar },
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
    
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error('Google Auth verification failed:', err);
    return res.status(401).json({ error: 'Google authentication failed', details: String(err) });
  }
});

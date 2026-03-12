import { Router, Express } from 'express';
import prisma from '../utils/prisma';

const router = Router();

// Store app reference for route listing
let appInstance: Express | null = null;
export const setAppInstance = (app: Express) => { appInstance = app; };

// List all registered routes
router.get('/routes', (req, res) => {
  if (!appInstance) {
    return res.json({ error: 'App instance not set' });
  }

  const routes: any[] = [];

  const extractRoutes = (stack: any[], basePath: string = '') => {
    stack.forEach((layer: any) => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
        routes.push({ method: methods, path: basePath + layer.route.path });
      } else if (layer.name === 'router' && layer.handle.stack) {
        const routerPath = layer.regexp.source
          .replace('\\/?', '')
          .replace('(?=\\/|$)', '')
          .replace(/\\\//g, '/')
          .replace('^', '')
          .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param');
        extractRoutes(layer.handle.stack, basePath + routerPath);
      }
    });
  };

  extractRoutes(appInstance._router.stack);

  // Filter for admin routes
  const adminRoutes = routes.filter(r => r.path.includes('/admin'));

  res.json({
    totalRoutes: routes.length,
    adminRoutes: adminRoutes,
    allRoutes: routes
  });
});

router.get('/', async (req, res) => {
  try {
    // 1. Check Date
    const now = new Date();

    // 2. Check DB Connection
    let dbStatus = 'Unknown';
    let userCount = -1;
    let errorDetail = null;
    
    try {
      userCount = await prisma.user.count();
      dbStatus = 'Connected';
    } catch (e: any) {
      dbStatus = 'Failed';
      errorDetail = e.message;
    }

    // 3. Check Env Vars (Masked)
    const dbUrl = process.env.DATABASE_URL || 'Not Set';
    const maskedDbUrl = dbUrl.length > 20 
      ? `${dbUrl.substring(0, 10)}...${dbUrl.substring(dbUrl.length - 10)}` 
      : dbUrl;

    res.json({
      status: 'Debug Info',
      timestamp: now.toISOString(),
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
        DATABASE_URL: maskedDbUrl,
      },
      database: {
        status: dbStatus,
        userCount: userCount,
        error: errorDetail
      }
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: 'Debug endpoint failed', 
      message: error.message,
      stack: error.stack 
    });
  }
});

export default router;

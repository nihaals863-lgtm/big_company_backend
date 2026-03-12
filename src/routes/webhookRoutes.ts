import { Router } from 'express';
import { handlePalmKashWebhook } from '../controllers/webhookController';

const router = Router();

// PalmKash Webhook Endpoint
router.post('/palmkash', handlePalmKashWebhook);

export default router;

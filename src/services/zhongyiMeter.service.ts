import axios, { AxiosInstance } from 'axios';

/**
 * Zhongyi Gas Meter Service
 *
 * Integration flow:
 *   1. Login  → POST /api/login  → cache token (30 min expiry)
 *   2. Query  → POST /api/meter/query  { meterNo }  → validate meter
 *   3. Recharge → POST /api/meter/recharge  { meterNo, amount, orderNo }  → returns token
 */

export interface ZhongyiMeterQueryResult {
    success: boolean;
    meterNo?: string;
    meterStatus?: string;
    ownerName?: string;
    raw?: any;
    error?: string;
}

export interface ZhongyiMeterRechargeParams {
    meterNumber: string;  // pure numeric, trimmed
    amount: number;
    customerRef: string;
}

export interface ZhongyiMeterRechargeResult {
    success: boolean;
    token?: string;
    meterNumber: string;
    amount: number;
    units: number;
    apiReference: string;
    message: string;
    raw?: any;
    error?: string;
}

class ZhongyiMeterService {
    private baseUrl: string;
    private username: string;
    private password: string;

    // In-memory token cache
    private cachedToken: string | null = null;
    private tokenExpiresAt: number = 0;   // Unix ms

    private http: AxiosInstance;

    constructor() {
        this.baseUrl = (process.env.ZHONGYI_BASE_URL || '').replace(/\/$/, '');
        this.username = process.env.ZHONGYI_USERNAME || '';
        this.password = process.env.ZHONGYI_PASSWORD || '';

        this.http = axios.create({
            baseURL: this.baseUrl,
            timeout: 20000,
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        });
    }

    // ─── Step 1: Login & Token Management ────────────────────────────────────

    private async getToken(): Promise<string> {
        const now = Date.now();

        // Return cached token if still valid (with 60s safety buffer)
        if (this.cachedToken && now < this.tokenExpiresAt - 60_000) {
            console.log('[Zhongyi] Using cached auth token.');
            return this.cachedToken;
        }

        console.log('[Zhongyi] Token expired or missing — logging in...');

        const response = await this.http.post('/api/login', {
            username: this.username,
            password: this.password,
        });

        const token = response.data?.data?.token;
        if (!token) {
            console.error('[Zhongyi] Login response:', JSON.stringify(response.data));
            throw new Error('Zhongyi login failed: no token in response.');
        }

        // Cache for 30 minutes
        this.cachedToken = token;
        this.tokenExpiresAt = now + 30 * 60 * 1000;
        console.log('[Zhongyi] Login successful, token cached for 30 min.');
        return token;
    }

    private authHeader(token: string) {
        return { Authorization: `Bearer ${token}` };
    }

    // ─── Step 2: Meter Query / Validation ────────────────────────────────────

    async queryMeter(meterNo: string): Promise<ZhongyiMeterQueryResult> {
        try {
            const token = await this.getToken();
            console.log(`[Zhongyi] Querying meter: ${meterNo}`);

            const response = await this.http.post(
                '/api/meter/query',
                { meterNo },
                { headers: this.authHeader(token) }
            );

            console.log('[Zhongyi] Meter query response:', JSON.stringify(response.data));

            const isSuccess =
                response.data?.code === 0 ||
                response.data?.success === true ||
                response.data?.status === 'SUCCESS' ||
                response.data?.data?.meterNo;

            if (!isSuccess) {
                return {
                    success: false,
                    error: response.data?.msg || response.data?.message || 'Meter not found or invalid.',
                    raw: response.data,
                };
            }

            return {
                success: true,
                meterNo: response.data?.data?.meterNo || meterNo,
                meterStatus: response.data?.data?.status || 'ACTIVE',
                ownerName: response.data?.data?.ownerName,
                raw: response.data,
            };
        } catch (err: any) {
            console.error('[Zhongyi] queryMeter error:', err.response?.data || err.message);

            // If token was rejected, clear cache so next call re-auths
            if (err.response?.status === 401) this.cachedToken = null;

            return {
                success: false,
                error: err.response?.data?.msg || err.message || 'Meter query failed',
            };
        }
    }

    // ─── Step 3: Recharge ────────────────────────────────────────────────────

    async rechargeMeter(params: ZhongyiMeterRechargeParams): Promise<ZhongyiMeterRechargeResult> {
        // Always sanitize
        const meterNo = params.meterNumber.trim();

        console.log(`[Zhongyi] Starting recharge: meter=${meterNo} amount=${params.amount} ref=${params.customerRef}`);

        try {
            // Step 1 – get auth token
            const token = await this.getToken();

            // Step 2 – validate meter
            const query = await this.queryMeter(meterNo);
            if (!query.success) {
                return {
                    success: false,
                    meterNumber: meterNo,
                    amount: params.amount,
                    units: 0,
                    apiReference: '',
                    message: query.error || 'Meter validation failed',
                    error: query.error,
                };
            }

            // Step 3 – recharge
            const rechargeBody = {
                meterNo,
                amount: params.amount,
                orderNo: params.customerRef,
            };

            console.log('[Zhongyi] Recharge request:', JSON.stringify(rechargeBody));

            const response = await this.http.post(
                '/api/meter/recharge',
                rechargeBody,
                { headers: this.authHeader(token) }
            );

            console.log('[Zhongyi] Recharge response:', JSON.stringify(response.data));

            const isSuccess =
                response.data?.code === 0 ||
                response.data?.success === true ||
                response.data?.status === 'SUCCESS' ||
                response.data?.data?.token;

            if (!isSuccess) {
                return {
                    success: false,
                    meterNumber: meterNo,
                    amount: params.amount,
                    units: 0,
                    apiReference: params.customerRef,
                    message: response.data?.msg || response.data?.message || 'Recharge rejected by Zhongyi API',
                    error: response.data?.msg || response.data?.message,
                    raw: response.data,
                };
            }

            const rechargeToken: string | undefined = response.data?.data?.token;
            const units = this.calculateUnits(params.amount);
            const apiRef =
                response.data?.data?.orderNo ||
                response.data?.data?.transactionId ||
                response.data?.orderNo ||
                params.customerRef;

            return {
                success: true,
                token: rechargeToken,
                meterNumber: meterNo,
                amount: params.amount,
                units,
                apiReference: String(apiRef),
                message: response.data?.msg || 'Zhongyi meter recharged successfully',
                raw: response.data,
            };

        } catch (err: any) {
            console.error('[Zhongyi] rechargeMeter error:', err.response?.data || err.message);
            if (err.response?.status === 401) this.cachedToken = null;

            return {
                success: false,
                meterNumber: meterNo,
                amount: params.amount,
                units: 0,
                apiReference: params.customerRef,
                message: 'Failed to connect to Zhongyi API',
                error: err.response?.data?.msg || err.message,
            };
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /** 1,500 RWF ≈ 1 kg LPG */
    private calculateUnits(amountRwf: number): number {
        return parseFloat((amountRwf / 1500).toFixed(4));
    }
}

export default new ZhongyiMeterService();

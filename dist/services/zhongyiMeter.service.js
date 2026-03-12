"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
class ZhongyiMeterService {
    constructor() {
        // In-memory token cache
        this.cachedToken = null;
        this.tokenExpiresAt = 0; // Unix ms
        this.baseUrl = (process.env.ZHONGYI_BASE_URL || '').replace(/\/$/, '');
        this.username = process.env.ZHONGYI_USERNAME || '';
        this.password = process.env.ZHONGYI_PASSWORD || '';
        this.http = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 20000,
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        });
    }
    // ─── Step 1: Login & Token Management ────────────────────────────────────
    getToken() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const now = Date.now();
            // Return cached token if still valid (with 60s safety buffer)
            if (this.cachedToken && now < this.tokenExpiresAt - 60000) {
                console.log('[Zhongyi] Using cached auth token.');
                return this.cachedToken;
            }
            console.log('[Zhongyi] Token expired or missing — logging in...');
            const response = yield this.http.post('/api/login', {
                username: this.username,
                password: this.password,
            });
            const token = (_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.token;
            if (!token) {
                console.error('[Zhongyi] Login response:', JSON.stringify(response.data));
                throw new Error('Zhongyi login failed: no token in response.');
            }
            // Cache for 30 minutes
            this.cachedToken = token;
            this.tokenExpiresAt = now + 30 * 60 * 1000;
            console.log('[Zhongyi] Login successful, token cached for 30 min.');
            return token;
        });
    }
    authHeader(token) {
        return { Authorization: `Bearer ${token}` };
    }
    // ─── Step 2: Meter Query / Validation ────────────────────────────────────
    queryMeter(meterNo) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
            try {
                const token = yield this.getToken();
                console.log(`[Zhongyi] Querying meter: ${meterNo}`);
                const response = yield this.http.post('/api/meter/query', { meterNo }, { headers: this.authHeader(token) });
                console.log('[Zhongyi] Meter query response:', JSON.stringify(response.data));
                const isSuccess = ((_a = response.data) === null || _a === void 0 ? void 0 : _a.code) === 0 ||
                    ((_b = response.data) === null || _b === void 0 ? void 0 : _b.success) === true ||
                    ((_c = response.data) === null || _c === void 0 ? void 0 : _c.status) === 'SUCCESS' ||
                    ((_e = (_d = response.data) === null || _d === void 0 ? void 0 : _d.data) === null || _e === void 0 ? void 0 : _e.meterNo);
                if (!isSuccess) {
                    return {
                        success: false,
                        error: ((_f = response.data) === null || _f === void 0 ? void 0 : _f.msg) || ((_g = response.data) === null || _g === void 0 ? void 0 : _g.message) || 'Meter not found or invalid.',
                        raw: response.data,
                    };
                }
                return {
                    success: true,
                    meterNo: ((_j = (_h = response.data) === null || _h === void 0 ? void 0 : _h.data) === null || _j === void 0 ? void 0 : _j.meterNo) || meterNo,
                    meterStatus: ((_l = (_k = response.data) === null || _k === void 0 ? void 0 : _k.data) === null || _l === void 0 ? void 0 : _l.status) || 'ACTIVE',
                    ownerName: (_o = (_m = response.data) === null || _m === void 0 ? void 0 : _m.data) === null || _o === void 0 ? void 0 : _o.ownerName,
                    raw: response.data,
                };
            }
            catch (err) {
                console.error('[Zhongyi] queryMeter error:', ((_p = err.response) === null || _p === void 0 ? void 0 : _p.data) || err.message);
                // If token was rejected, clear cache so next call re-auths
                if (((_q = err.response) === null || _q === void 0 ? void 0 : _q.status) === 401)
                    this.cachedToken = null;
                return {
                    success: false,
                    error: ((_s = (_r = err.response) === null || _r === void 0 ? void 0 : _r.data) === null || _s === void 0 ? void 0 : _s.msg) || err.message || 'Meter query failed',
                };
            }
        });
    }
    // ─── Step 3: Recharge ────────────────────────────────────────────────────
    rechargeMeter(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
            // Always sanitize
            const meterNo = params.meterNumber.trim();
            console.log(`[Zhongyi] Starting recharge: meter=${meterNo} amount=${params.amount} ref=${params.customerRef}`);
            try {
                // Step 1 – get auth token
                const token = yield this.getToken();
                // Step 2 – validate meter
                const query = yield this.queryMeter(meterNo);
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
                const response = yield this.http.post('/api/meter/recharge', rechargeBody, { headers: this.authHeader(token) });
                console.log('[Zhongyi] Recharge response:', JSON.stringify(response.data));
                const isSuccess = ((_a = response.data) === null || _a === void 0 ? void 0 : _a.code) === 0 ||
                    ((_b = response.data) === null || _b === void 0 ? void 0 : _b.success) === true ||
                    ((_c = response.data) === null || _c === void 0 ? void 0 : _c.status) === 'SUCCESS' ||
                    ((_e = (_d = response.data) === null || _d === void 0 ? void 0 : _d.data) === null || _e === void 0 ? void 0 : _e.token);
                if (!isSuccess) {
                    return {
                        success: false,
                        meterNumber: meterNo,
                        amount: params.amount,
                        units: 0,
                        apiReference: params.customerRef,
                        message: ((_f = response.data) === null || _f === void 0 ? void 0 : _f.msg) || ((_g = response.data) === null || _g === void 0 ? void 0 : _g.message) || 'Recharge rejected by Zhongyi API',
                        error: ((_h = response.data) === null || _h === void 0 ? void 0 : _h.msg) || ((_j = response.data) === null || _j === void 0 ? void 0 : _j.message),
                        raw: response.data,
                    };
                }
                const rechargeToken = (_l = (_k = response.data) === null || _k === void 0 ? void 0 : _k.data) === null || _l === void 0 ? void 0 : _l.token;
                const units = this.calculateUnits(params.amount);
                const apiRef = ((_o = (_m = response.data) === null || _m === void 0 ? void 0 : _m.data) === null || _o === void 0 ? void 0 : _o.orderNo) ||
                    ((_q = (_p = response.data) === null || _p === void 0 ? void 0 : _p.data) === null || _q === void 0 ? void 0 : _q.transactionId) ||
                    ((_r = response.data) === null || _r === void 0 ? void 0 : _r.orderNo) ||
                    params.customerRef;
                return {
                    success: true,
                    token: rechargeToken,
                    meterNumber: meterNo,
                    amount: params.amount,
                    units,
                    apiReference: String(apiRef),
                    message: ((_s = response.data) === null || _s === void 0 ? void 0 : _s.msg) || 'Zhongyi meter recharged successfully',
                    raw: response.data,
                };
            }
            catch (err) {
                console.error('[Zhongyi] rechargeMeter error:', ((_t = err.response) === null || _t === void 0 ? void 0 : _t.data) || err.message);
                if (((_u = err.response) === null || _u === void 0 ? void 0 : _u.status) === 401)
                    this.cachedToken = null;
                return {
                    success: false,
                    meterNumber: meterNo,
                    amount: params.amount,
                    units: 0,
                    apiReference: params.customerRef,
                    message: 'Failed to connect to Zhongyi API',
                    error: ((_w = (_v = err.response) === null || _v === void 0 ? void 0 : _v.data) === null || _w === void 0 ? void 0 : _w.msg) || err.message,
                };
            }
        });
    }
    // ─── Helpers ──────────────────────────────────────────────────────────────
    /** 1,500 RWF ≈ 1 kg LPG */
    calculateUnits(amountRwf) {
        return parseFloat((amountRwf / 1500).toFixed(4));
    }
}
exports.default = new ZhongyiMeterService();

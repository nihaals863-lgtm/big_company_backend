import axios from 'axios';

export interface PipingMeterRechargeParams {
    meterNumber: string;
    amount: number;        // Amount in RWF
    customerRef: string;   // Internal tracking reference
    customerPhone?: string;
}

export interface PipingMeterRechargeResult {
    success: boolean;
    meterNumber?: string;
    amount?: number;
    units?: number;
    apiReference?: string;   // orderId from Lorawan API
    message?: string;
    error?: string;
}

// async function rechargePipingGasMeter(meterNo: string, amount: number) {
//     // 1. Call login API
//     const loginPayload = {
//       action: "lorawanMeter",
//       method: "toLogin",
//       params: {
//         username: "Rwanda_Kayitare",
//         password: "123456"
//       }
//     };

//     const loginResponse = await axios.post(
//       "http://english.energyy.ucskype.com/api/commonInternal.jsp",
//       `requestParams=${encodeURIComponent(JSON.stringify(loginPayload))}`,
//       { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
//     );

//     // 2. Extract apiToken
//     const apiToken = loginResponse.data?.value?.apiToken;

//     if (!apiToken) {
//         throw new Error("Failed to get API Token from Login");
//     }

//     // 3. Call recharge API
//     const rechargePayload = {
//       action: "lorawanMeter",
//       method: "recharge",
//       params: {
//         meterNo: meterNo,
//         amount: String(amount),
//         apiToken: apiToken
//       }
//     };

//     const rechargeResponse = await axios.post(
//       "http://english.energyy.ucskype.com/api/commonInternal.jsp",
//       `requestParams=${encodeURIComponent(JSON.stringify(rechargePayload))}`,
//       { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
//     );

//     // 4. Return response
//     return rechargeResponse.data;
// }
async function rechargePipingGasMeter(meterNo: string, amount: number) {

    const loginPayload = {
        action: "lorawanMeter",
        method: "toLogin",
        params: {
            username: "Rwanda_Kayitare",
            password: "123456"
        }
    };

    const loginResponse = await axios.post(
        "http://english.energyy.ucskype.com/api/commonInternal.jsp",
        `requestParams=${encodeURIComponent(JSON.stringify(loginPayload))}`,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const apiToken = loginResponse.data?.value?.apiToken;

    if (!apiToken) {
        throw new Error("Failed to get API Token from Login");
    }

    const rechargePayload = {
        action: "lorawanMeter",
        method: "remotelyTopUp",
        apiToken: apiToken,
        param: {
            devEui: meterNo,
            topUpAmount: String(amount),
            topUpToDeviceAmount: String(amount)
        }
    };

    const rechargeResponse = await axios.post(
        "http://english.energyy.ucskype.com/api/commonInternal.jsp",
        `requestParams=${encodeURIComponent(JSON.stringify(rechargePayload))}`,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    return rechargeResponse.data;
}
class PipingMeterService {

    async rechargePipingMeter(params: PipingMeterRechargeParams): Promise<PipingMeterRechargeResult> {
        const isDev = process.env.DEV_MODE === 'true' || process.env.DEV_MODE === '1';

        // ── DEV MODE: return a simulated success ─────────────────────────
        if (isDev) {
            console.log(`🛠️ [PipingMeter DEV] Simulating Lorawan recharge for meter: ${params.meterNumber}, Amount: ${params.amount}`);
            const units = this.calculateUnits(params.amount);
            return {
                success: true,
                meterNumber: params.meterNumber,
                amount: params.amount,
                units,
                apiReference: `DEV-LORAWAN-${Date.now()}`,
                message: `Piping meter recharged successfully with ${units} m³ (DEV_MODE)`,
            };
        }

        // ── PRODUCTION: real Lorawan API call ────────────────────────────
        try {
            console.log(`[PipingMeter] Initiating top-up for ${params.amount} on meter ${params.meterNumber}...`);

            const responseData = await rechargePipingGasMeter(params.meterNumber, params.amount);
            console.log(`[PipingMeter] API Response:`, JSON.stringify(responseData));

            // Check success based on errcode (usually 0 is success)
            if (responseData?.errcode === '0' || responseData?.errcode === 0 || responseData?.success) {
                const units = this.calculateUnits(params.amount);
                return {
                    success: true,
                    meterNumber: params.meterNumber,
                    amount: params.amount,
                    units,
                    apiReference: responseData?.value?.orderId || `API-${Date.now()}`,
                    message: `Piping gas meter recharged successfully.`,
                };
            } else {
                return {
                    success: false,
                    error: responseData?.errmsg || responseData?.message || 'Recharge failed on the provider side.',
                    apiReference: String(Date.now()),
                };
            }

        } catch (error: any) {
            console.error('[PipingMeter] Unexpected error:', error.message);
            return {
                success: false,
                error: error.message || 'Failed to connect to Piping Meter API',
            };
        }
    }

    private calculateUnits(amountRwf: number): number {
        const ratePerM3 = Number(process.env.LORAWAN_RATE_PER_M3) || 850;
        return parseFloat((amountRwf / ratePerM3).toFixed(4));
    }
}

export default new PipingMeterService();

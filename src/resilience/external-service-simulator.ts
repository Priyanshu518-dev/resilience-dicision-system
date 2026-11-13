export type ChaosMode =
  | 'HEALTHY'
  | 'TRANSIENT_FAILURE'
  | 'PERMANENT_FAILURE'
  | 'TIMEOUT'
  | 'RATE_LIMIT';

export interface ChaosConfig {
  mode: ChaosMode;
  transientFailuresRemaining: number;
  simulatedLatencyMs: number;
  failureErrorCode: string;
  failureErrorMessage: string;
}

export class ExternalDependencyError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly statusCode: number;

  constructor(message: string, code = 'EXTERNAL_DEPENDENCY_ERROR', retryable = true, statusCode = 503) {
    super(message);
    this.name = 'ExternalDependencyError';
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

export class ExternalServiceSimulator {
  private static instance: ExternalServiceSimulator;
  private config: ChaosConfig = {
    mode: 'HEALTHY',
    transientFailuresRemaining: 2,
    simulatedLatencyMs: 50,
    failureErrorCode: 'SERVICE_UNAVAILABLE',
    failureErrorMessage: 'Simulated external service temporary outage',
  };

  private attemptCounters: Map<string, number> = new Map();

  public static getInstance(): ExternalServiceSimulator {
    if (!ExternalServiceSimulator.instance) {
      ExternalServiceSimulator.instance = new ExternalServiceSimulator();
    }
    return ExternalServiceSimulator.instance;
  }

  public setChaosConfig(newConfig: Partial<ChaosConfig>): ChaosConfig {
    this.config = { ...this.config, ...newConfig };
    return this.getConfig();
  }

  public resetChaos(): void {
    this.config = {
      mode: 'HEALTHY',
      transientFailuresRemaining: 2,
      simulatedLatencyMs: 50,
      failureErrorCode: 'SERVICE_UNAVAILABLE',
      failureErrorMessage: 'Simulated external service temporary outage',
    };
    this.attemptCounters.clear();
  }

  public getConfig(): ChaosConfig {
    return { ...this.config };
  }

  /**
   * Main entry point to invoke simulated external integrations
   */
  public async callService(
    serviceName: string,
    payload: Record<string, any>,
    overrideMode?: ChaosMode
  ): Promise<Record<string, any>> {
    const effectiveMode = overrideMode || this.config.mode;
    const callKey = `${serviceName}_${payload.applicantId || payload.id || 'default'}`;
    const attempts = (this.attemptCounters.get(callKey) || 0) + 1;
    this.attemptCounters.set(callKey, attempts);

    // Latency simulation
    if (this.config.simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.simulatedLatencyMs));
    }

    // Handle Chaos Modes
    if (effectiveMode === 'TRANSIENT_FAILURE') {
      if (this.config.transientFailuresRemaining > 0) {
        this.config.transientFailuresRemaining--;
        throw new ExternalDependencyError(
          `[Transient Failure] ${serviceName} is temporarily unavailable (Attempts left to fail: ${this.config.transientFailuresRemaining})`,
          'TRANSIENT_SERVICE_UNAVAILABLE',
          true,
          503
        );
      }
      // Once transientFailuresRemaining reaches 0, succeed!
    } else if (effectiveMode === 'PERMANENT_FAILURE') {
      throw new ExternalDependencyError(
        `[Permanent Failure] ${serviceName} encountered an unrecoverable system outage`,
        'PERMANENT_EXTERNAL_FAILURE',
        false,
        500
      );
    } else if (effectiveMode === 'TIMEOUT') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new ExternalDependencyError(
        `[Timeout] Connection to ${serviceName} timed out after 300ms`,
        'GATEWAY_TIMEOUT',
        true,
        504
      );
    } else if (effectiveMode === 'RATE_LIMIT') {
      throw new ExternalDependencyError(
        `[Rate Limit] Too many requests dispatched to ${serviceName}`,
        'RATE_LIMIT_EXCEEDED',
        true,
        429
      );
    }

    // Healthy execution mock responses
    return this.generateHealthyResponse(serviceName, payload);
  }

  private generateHealthyResponse(serviceName: string, payload: any): Record<string, any> {
    switch (serviceName) {
      case 'credit_bureau':
        // Generate deterministic credit score based on applicant input or default
        const baseScore = payload.applicant?.creditScore || payload.creditScore || 720;
        return {
          creditScore: baseScore,
          bureauReportId: `BUR-${Math.floor(100000 + Math.random() * 900000)}`,
          openCreditLines: payload.openCreditLines ?? 4,
          delinquencyCount: payload.delinquencyCount ?? 0,
          verifiedAnnualIncome: payload.applicant?.annualIncome || payload.annualIncome || 85000,
          debtToIncomeRatio:
            payload.applicant?.debtToIncomeRatio ||
            (payload.monthlyDebt && payload.monthlyIncome ? payload.monthlyDebt / payload.monthlyIncome : 0.28),
          bureauVerifiedAt: new Date().toISOString(),
        };

      case 'fraud_detection':
        const requestedAmount = payload.requestedAmount || payload.amount || 1000;
        const riskScore = requestedAmount > 100000 ? 65 : requestedAmount > 50000 ? 30 : 12;
        return {
          fraudRiskScore: riskScore,
          riskLevel: riskScore > 50 ? 'HIGH' : riskScore > 25 ? 'MEDIUM' : 'LOW',
          isBlacklisted: false,
          deviceReputation: 'TRUSTED',
          geolocationMatch: true,
          screenedAt: new Date().toISOString(),
        };

      case 'kyc_verification':
        return {
          idVerificationStatus: 'PASSED',
          sanctionsListMatch: false,
          pepStatus: false,
          biometricMatchConfidence: 0.98,
          documentExpiryValid: true,
          verifiedAt: new Date().toISOString(),
        };

      case 'vendor_registry':
        return {
          businessRegistrationValid: true,
          tinStatus: 'ACTIVE',
          taxClearanceValid: true,
          dunsRating: 'A+',
          registryVerifiedAt: new Date().toISOString(),
        };

      default:
        return {
          status: 'SUCCESS',
          service: serviceName,
          timestamp: new Date().toISOString(),
        };
    }
  }
}

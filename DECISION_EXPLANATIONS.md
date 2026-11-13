# Decision Explanation Examples & Audit Reasoning

This document demonstrates real-world decision walkthroughs across different workflows, detailing **input payloads**, **external enrichment**, **rules evaluated**, **resulting verdicts**, and **audit trail reasoning**.

---

## Example 1: Instant Prime Loan Approval (Happy Path)

### Business Context
A high-credit applicant applies for a $28,000 personal loan. The system runs schema validation, fetches credit history from the simulated credit bureau and fraud score from the fraud engine, and evaluates underwriting policy rules.

### Request Payload
```json
{
  "applicantName": "Marcus Aurelius",
  "requestedAmount": 28000,
  "annualIncome": 95000,
  "employmentStatus": "EMPLOYED",
  "creditScore": 750
}
```

### External Enrichment
- **`credit_bureau`:**
  - `creditScore`: `750`
  - `debtToIncomeRatio`: `0.28`
  - `openCreditLines`: `4`
- **`fraud_detection`:**
  - `fraudRiskScore`: `12` (Low)

### Rule Evaluation Trace
| Rule ID | Rule Name | Evaluated Condition | Actual Value | Verdict | Action |
|---|---|---|---|---|---|
| `RULE_FRAUD_HIGH` | High Fraud Filter | `fraudRiskScore > 50` | `12` | ❌ Not Triggered | None |
| `RULE_CREDIT_SUBPRIME` | Subprime Filter | `creditScore < 600` | `750` | ❌ Not Triggered | None |
| `RULE_DTI_EXCESSIVE` | DTI Limit | `debtToIncomeRatio > 0.50` | `0.28` | ❌ Not Triggered | None |
| `RULE_BORDERLINE_MANUAL_REVIEW` | Discretionary Band | `creditScore between [600, 679]` | `750` | ❌ Not Triggered | None |
| `RULE_PRIME_AUTO_APPROVAL` | Prime Tier Approval | `creditScore >= 680` AND `debtToIncomeRatio <= 0.45` | `750`, `0.28` | ✅ **Triggered** | **APPROVE** |

### Output Decision & Mutations
```json
{
  "verdict": "APPROVED",
  "state": "APPROVED",
  "reasonCodes": ["APPROVE_PRIME"],
  "explanationSummary": "Application APPROVED. Successfully met all requirements (1 checks satisfied).",
  "mutations": {
    "interestRateOffered": "6.49%",
    "maxPreapprovedAmount": 45000
  }
}
```

### Audit Reasoning Log
```text
[2026-11-13T17:55:00Z] [REQUEST_RECEIVED] Workflow request received for Personal & Auto Loan Decision Workflow (v1.0.0).
[2026-11-13T17:55:01Z] [VALIDATION_PASSED] Validation stage 'Application Intake & Schema Validation' passed.
[2026-11-13T17:55:02Z] [EXTERNAL_DEPENDENCY_CALLED] Dispatched call to external dependency 'credit_bureau'.
[2026-11-13T17:55:03Z] [EXTERNAL_DEPENDENCY_RECOVERED] Dependency 'credit_bureau' successfully enriched context.
[2026-11-13T17:55:04Z] [EXTERNAL_DEPENDENCY_CALLED] Dispatched call to external dependency 'fraud_detection'.
[2026-11-13T17:55:05Z] [RULE_EVALUATION_STARTED] Started evaluating ruleset 'ruleset_loan_v1'.
[2026-11-13T17:55:05Z] [FINAL_DECISION] Final verdict: APPROVED. Prime applicant qualification verified.
```

---

## Example 2: Subprime Rejection (Low Credit Cutoff)

### Business Context
Applicant applies with a credit score of 540, below the risk appetite cutoff.

### Request Payload
```json
{
  "applicantName": "Bob Vance",
  "requestedAmount": 20000,
  "annualIncome": 38000,
  "employmentStatus": "EMPLOYED",
  "creditScore": 540
}
```

### External Enrichment
- **`credit_bureau`:** `creditScore = 540`, `debtToIncomeRatio = 0.35`
- **`fraud_detection`:** `fraudRiskScore = 12`

### Rule Evaluation Trace
| Rule ID | Rule Name | Condition | Actual Value | Verdict | Action |
|---|---|---|---|---|---|
| `RULE_FRAUD_HIGH` | High Fraud Filter | `fraudRiskScore > 50` | `12` | ❌ Not Triggered | None |
| `RULE_CREDIT_SUBPRIME` | Subprime Cutoff | `creditScore < 600` | `540` | ✅ **Triggered** | **REJECT** |

### Output Decision
```json
{
  "verdict": "REJECTED",
  "state": "REJECTED",
  "reasonCodes": ["REJECT_LOW_CREDIT"],
  "explanationSummary": "Application was REJECTED. Failed criteria: [REJECT_LOW_CREDIT] Credit score does not meet the minimum underwriting cutoff of 600"
}
```

---

## Example 3: Borderline Credit Escalated to Manual Review

### Business Context
Applicant has a credit score of 640 (falls between 600 and 679). System automatically pauses execution in `PENDING_REVIEW` state and creates a review task for loan officers.

### Request Payload
```json
{
  "applicantName": "David Miller",
  "requestedAmount": 18000,
  "annualIncome": 55000,
  "employmentStatus": "EMPLOYED",
  "creditScore": 640
}
```

### Intermediate Stage Output
```json
{
  "state": "PENDING_REVIEW",
  "decision": {
    "verdict": "MANUAL_REVIEW_REQUIRED",
    "reasonCodes": ["REVIEW_BORDERLINE_CREDIT"],
    "explanationSummary": "Application escalated for MANUAL REVIEW. Review triggers: [REVIEW_BORDERLINE_CREDIT] Credit score falls within the discretionary manual underwriting band [600-679]"
  },
  "manualReview": {
    "requestedAt": "2026-11-13T18:00:00Z",
    "reasonCodes": ["REVIEW_BORDERLINE_CREDIT"],
    "reasons": ["Credit score falls within the discretionary manual underwriting band [600-679]"]
  }
}
```

### Human Supervisor Adjudication
Underwriter reviews collateral and employment longevity, executing review approval via API / UI:
- **Reviewer:** `Underwriter-Sarah`
- **Verdict:** `APPROVED`
- **Justification:** *"Applicant confirmed 8 years tenure with verified collateral."*

### Final State After Review
```json
{
  "state": "APPROVED",
  "decision": {
    "verdict": "APPROVED",
    "decidedBy": "REVIEWER:Underwriter-Sarah",
    "explanationSummary": "Manual review completed by Underwriter-Sarah: APPROVED. Notes: Applicant confirmed 8 years tenure with verified collateral."
  }
}
```

---

## Example 4: High Fraud Risk Rejection

### Business Context
Request triggers elevated fraud risk indicator during enrichment ($150,000 requested on anomalous connection).

### Request Payload
```json
{
  "applicantName": "Anonymous Proxy",
  "requestedAmount": 150000,
  "annualIncome": 80000,
  "employmentStatus": "EMPLOYED",
  "creditScore": 780
}
```

### External Enrichment
- **`fraud_detection`:** `fraudRiskScore = 65` (High Risk)

### Rule Evaluation
- `RULE_FRAUD_HIGH` evaluates `fraudRiskScore (65) > 50` -> **Triggered**.
- **Verdict:** `REJECTED`.
- **Reason Code:** `REJECT_FRAUD_RISK`.
- **Audit Explanation:** *"Application flagged by automated fraud intelligence detection (Score > 50)"*.

---

## Example 5: Schema Validation Rejection (Invalid Input)

### Request Payload
```json
{
  "requestedAmount": 100,
  "annualIncome": 2000,
  "employmentStatus": "UNAUTHORIZED_VALUE"
}
```

### Validation Result
- `applicantName`: Field is mandatory but was missing or empty.
- `requestedAmount`: (100) is below minimum limit of 500.
- `annualIncome`: (2000) is below minimum limit of 10000.
- `employmentStatus`: ('UNAUTHORIZED_VALUE') is not in allowed list: [EMPLOYED, SELF_EMPLOYED, UNEMPLOYED, RETIRED].

### Output Decision
- **State:** `REJECTED`.
- **Decided By:** `SCHEMA_VALIDATOR`.
- **Verdict:** `REJECTED`.
- **Audit Event:** `VALIDATION_FAILED`.

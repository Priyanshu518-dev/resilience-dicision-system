let workflows = [];

window.addEventListener('DOMContentLoaded', () => {
  loadWorkflows();
  loadMetrics();
  loadPreset('APPROVED');
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach((tc) => tc.classList.remove('active'));

  event.target.classList.add('active');
  const target = document.getElementById(`tab-${tab}`);
  if (target) target.classList.add('active');

  if (tab === 'reviews') loadManualReviews();
  if (tab === 'audit') loadExecutions();
}

async function loadMetrics() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    document.getElementById('workflow-count-badge').textContent = `Workflows: ${data.metrics.registeredWorkflows}`;
    document.getElementById('pending-reviews-badge').textContent = `Reviews: ${data.metrics.pendingManualReviews}`;
  } catch (err) {
    console.error('Failed to load metrics:', err);
  }
}

async function loadWorkflows() {
  try {
    const res = await fetch('/api/workflows');
    const json = await res.json();
    workflows = json.data || [];

    const select = document.getElementById('workflow-select');
    select.innerHTML = '';

    workflows.forEach((w) => {
      const opt = document.createElement('option');
      opt.value = `${w.id}@${w.version}`;
      opt.textContent = `${w.name} (v${w.version}) [ID: ${w.id}]`;
      select.appendChild(opt);
    });

    renderWorkflowCatalog();
  } catch (err) {
    console.error('Failed to load workflows:', err);
  }
}

function onWorkflowChange() {
  loadPreset('APPROVED');
}

function generateIdempotencyKey() {
  const uuid = 'req-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
  document.getElementById('idempotency-key-input').value = uuid;
}

function loadPreset(type) {
  const select = document.getElementById('workflow-select').value;
  const isV2 = select.includes('2.0.0');
  const isClaim = select.includes('insurance-claim');
  const isKyc = select.includes('kyc-verification');
  const isVendor = select.includes('vendor-onboarding');

  let payload = {};

  if (isClaim) {
    switch (type) {
      case 'APPROVED':
        payload = { claimantName: 'Sarah Connor', policyNumber: 'POL-9921', incidentType: 'WATER_DAMAGE', claimAmount: 850 };
        break;
      case 'MANUAL_REVIEW':
        payload = { claimantName: 'John Connor', policyNumber: 'POL-1102', incidentType: 'AUTO_ACCIDENT', claimAmount: 32000 };
        break;
      case 'HIGH_FRAUD':
        payload = { claimantName: 'Scam Artist', policyNumber: 'POL-0000', incidentType: 'THEFT', claimAmount: 50000 };
        break;
      case 'INVALID':
        payload = { claimantName: '', policyNumber: 'POL-1', incidentType: 'INVALID_TYPE', claimAmount: 10 };
        break;
      default:
        payload = { claimantName: 'Sarah Connor', policyNumber: 'POL-9921', incidentType: 'WATER_DAMAGE', claimAmount: 850 };
    }
  } else if (isKyc) {
    switch (type) {
      case 'APPROVED':
        payload = { fullName: 'Elena Rostova', idDocumentType: 'PASSPORT', idDocumentNumber: 'P8921829', countryOfIssuance: 'CAN' };
        break;
      case 'INVALID':
        payload = { fullName: '', idDocumentType: 'BUS_PASS', idDocumentNumber: '', countryOfIssuance: '' };
        break;
      default:
        payload = { fullName: 'Elena Rostova', idDocumentType: 'PASSPORT', idDocumentNumber: 'P8921829', countryOfIssuance: 'CAN' };
    }
  } else if (isVendor) {
    switch (type) {
      case 'APPROVED':
        payload = { companyName: 'Acme Logistics LLC', taxId: 'TAX-88992', annualTurnover: 450000, category: 'LOGISTICS' };
        break;
      case 'INVALID':
        payload = { companyName: '', taxId: '', annualTurnover: 1000, category: 'GAMBLING' };
        break;
      default:
        payload = { companyName: 'Acme Logistics LLC', taxId: 'TAX-88992', annualTurnover: 450000, category: 'LOGISTICS' };
    }
  } else {
    // Loan Approval
    switch (type) {
      case 'APPROVED':
        payload = {
          applicantName: 'Marcus Aurelius',
          requestedAmount: 30000,
          annualIncome: isV2 ? 110000 : 90000,
          employmentStatus: 'EMPLOYED',
          creditScore: isV2 ? 740 : 700,
        };
        break;
      case 'MANUAL_REVIEW':
        payload = {
          applicantName: 'David Miller',
          requestedAmount: 20000,
          annualIncome: 55000,
          employmentStatus: 'EMPLOYED',
          creditScore: isV2 ? 660 : 640,
        };
        break;
      case 'REJECTED':
        payload = {
          applicantName: 'Bob Vance',
          requestedAmount: 15000,
          annualIncome: 35000,
          employmentStatus: 'EMPLOYED',
          creditScore: 550,
        };
        break;
      case 'HIGH_FRAUD':
        payload = {
          applicantName: 'Anonymous Proxy',
          requestedAmount: 150000, // triggers high fraud score in mock
          annualIncome: 80000,
          employmentStatus: 'EMPLOYED',
          creditScore: 780,
        };
        break;
      case 'INVALID':
        payload = {
          applicantName: '',
          requestedAmount: 100, // below minimum 500
          annualIncome: 5000, // below minimum
          employmentStatus: 'STUDENT_UNSUPPORTED',
        };
        break;
    }
  }

  document.getElementById('payload-input').value = JSON.stringify(payload, null, 2);
}

async function executeWorkflow() {
  const selectedWf = document.getElementById('workflow-select').value;
  const [workflowId, version] = selectedWf.split('@');
  const payloadStr = document.getElementById('payload-input').value;
  const idempotencyKey = document.getElementById('idempotency-key-input').value.trim();
  const chaosMode = document.getElementById('chaos-mode-select').value;

  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch (err) {
    alert('Invalid JSON in payload editor!');
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  if (chaosMode !== 'HEALTHY') headers['x-simulate-chaos'] = chaosMode;

  try {
    const res = await fetch(`/api/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, version }),
    });

    const isReplay = res.headers.get('x-idempotent-replay') === 'true';
    const json = await res.json();

    if (!res.ok) {
      if (res.status === 409) {
        alert(`⚠️ Idempotency Conflict Detected:\n${json.message}`);
      } else {
        alert(`Execution Error: ${json.error || json.message}`);
      }
      return;
    }

    renderExecutionOutcome(json.data, isReplay);
    loadMetrics();
  } catch (err) {
    alert(`Network request failed: ${err.message}`);
  }
}

function renderExecutionOutcome(execution, isReplay) {
  document.getElementById('outcome-empty').style.display = 'none';
  document.getElementById('outcome-details').style.display = 'block';

  document.getElementById('replay-indicator').style.display = isReplay ? 'inline-block' : 'none';

  const verdict = execution.decision?.verdict || execution.state;
  const badge = document.getElementById('verdict-badge');
  badge.textContent = verdict;
  badge.className = `status-pill status-${verdict}`;

  document.getElementById('execution-id-display').textContent = `ID: ${execution.id}`;
  document.getElementById('decision-summary-text').textContent =
    execution.decision?.explanationSummary || 'Decision pending review or completion';

  // Timeline
  const tl = document.getElementById('timeline-container');
  tl.innerHTML = '';
  (execution.stateHistory || []).forEach((h) => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.innerHTML = `
      <div class="timeline-dot"></div>
      <div class="timeline-title">${h.fromState} ➔ ${h.toState} (${h.actor})</div>
      <div class="timeline-time">${new Date(h.timestamp).toLocaleTimeString()} - ${h.reason}</div>
    `;
    tl.appendChild(item);
  });

  // Rule traces
  const tbody = document.querySelector('#rule-trace-table tbody');
  tbody.innerHTML = '';
  (execution.ruleTraces || []).forEach((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="status-pill status-${t.passed ? 'APPROVED' : 'REJECTED'}">${t.passed ? 'PASSED' : 'TRIGGERED'}</span></td>
      <td><strong>${t.ruleName}</strong><br><span style="color: var(--text-muted); font-size: 0.75rem;">${t.ruleId}</span></td>
      <td>${t.explanation}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadManualReviews() {
  try {
    const res = await fetch('/api/executions?state=PENDING_REVIEW');
    const json = await res.json();
    const reviews = json.data || [];

    const tbody = document.querySelector('#reviews-table tbody');
    tbody.innerHTML = '';

    if (reviews.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No executions currently pending review.</td></tr>';
      return;
    }

    reviews.forEach((r) => {
      const tr = document.createElement('tr');
      const reasons = (r.manualReview?.reasons || []).join(', ');
      tr.innerHTML = `
        <td><code>${r.id.substring(0, 8)}...</code></td>
        <td>${r.workflowId} (v${r.workflowVersion})</td>
        <td>${new Date(r.manualReview?.requestedAt || r.createdAt).toLocaleTimeString()}</td>
        <td><span style="color: #fbbf24;">${reasons}</span></td>
        <td>
          <button class="btn btn-success" style="padding: 4px 8px; font-size: 0.75rem;" onclick="submitReview('${r.id}', 'APPROVED')">Approve</button>
          <button class="btn btn-danger" style="padding: 4px 8px; font-size: 0.75rem;" onclick="submitReview('${r.id}', 'REJECTED')">Reject</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load reviews:', err);
  }
}

async function submitReview(id, verdict) {
  const notes = prompt(`Provide justification notes for ${verdict}:`, `Reviewed and verified by supervisor.`);
  if (!notes) return;

  try {
    const res = await fetch(`/api/executions/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId: 'Supervisor-1', verdict, notes }),
    });

    if (res.ok) {
      alert(`Manual review submitted: ${verdict}`);
      loadManualReviews();
      loadMetrics();
    } else {
      const err = await res.json();
      alert(`Error submitting review: ${err.error}`);
    }
  } catch (err) {
    alert(`Failed to submit review: ${err.message}`);
  }
}

async function loadExecutions() {
  try {
    const res = await fetch('/api/executions');
    const json = await res.json();
    const list = json.data || [];

    const tbody = document.querySelector('#executions-table tbody');
    tbody.innerHTML = '';

    list.forEach((e) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${e.id.substring(0, 8)}...</code></td>
        <td>${e.workflowId} (v${e.workflowVersion})</td>
        <td><span class="status-pill status-${e.state}">${e.state}</span></td>
        <td>${e.decision?.verdict || 'N/A'}</td>
        <td>${new Date(e.createdAt).toLocaleTimeString()}</td>
        <td><button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="viewExecutionAudit('${e.id}')">Audit Trail</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load executions:', err);
  }
}

async function viewExecutionAudit(id) {
  try {
    const res = await fetch(`/api/executions/${id}/audit`);
    const data = await res.json();
    renderExecutionOutcome(data, false);
    switchTab('console');
  } catch (err) {
    alert('Failed to fetch audit: ' + err.message);
  }
}

function renderWorkflowCatalog() {
  const container = document.getElementById('workflow-catalog-list');
  container.innerHTML = '';

  workflows.forEach((w) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.marginBottom = '16px';
    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h3 style="color: #60a5fa;">${w.name} <span class="badge">v${w.version}</span></h3>
        <code>${w.id}</code>
      </div>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 12px;">${w.description}</p>
      <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 6px;">Configured Stages (${w.stages.length}):</div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${w.stages.map((s) => `<span class="badge" style="background: var(--bg-primary);">${s.name} (${s.type})</span>`).join(' ➔ ')}
      </div>
    `;
    container.appendChild(div);
  });
}

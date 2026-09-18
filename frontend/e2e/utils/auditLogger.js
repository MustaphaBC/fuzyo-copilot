import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const AUDIT_REPORT_PATH = path.join(__dirname, '../../ui_audit_report.md')

function stamp() {
  return new Date().toISOString()
}

export function clearAuditReport() {
  const header = [
    '# Fuzyo UI Audit Report',
    '',
    `Run started: ${stamp()}`,
    '',
    '## Issues',
    '',
  ].join('\n')
  fs.writeFileSync(AUDIT_REPORT_PATH, header, 'utf8')
}

export function logAudit({ category, message, url = '', details = '' }) {
  const block = [
    `### ${category}`,
    '',
    `- **Time:** ${stamp()}`,
    `- **URL:** ${url || '(n/a)'}`,
    `- **Message:** ${message}`,
    details ? `- **Details:** ${details}` : null,
    '',
  ]
    .filter(Boolean)
    .join('\n')
  fs.appendFileSync(AUDIT_REPORT_PATH, `${block}\n`, 'utf8')
}

export function writeAuditSummary({ passedSteps = [], failedSteps = [] } = {}) {
  const lines = [
    '## Summary',
    '',
    `- **Finished:** ${stamp()}`,
    `- **Passed steps:** ${passedSteps.length}`,
    `- **Failed steps:** ${failedSteps.length}`,
    '',
  ]
  if (passedSteps.length) {
    lines.push('### Passed')
    for (const step of passedSteps) lines.push(`- ${step}`)
    lines.push('')
  }
  if (failedSteps.length) {
    lines.push('### Failed')
    for (const step of failedSteps) lines.push(`- ${step}`)
    lines.push('')
  }
  fs.appendFileSync(AUDIT_REPORT_PATH, `${lines.join('\n')}\n`, 'utf8')
}

/**
 * Attach browser listeners that append anomalies to the audit report.
 * @param {import('@playwright/test').Page} page
 */
export function attachAuditListeners(page) {
  page.on('console', (msg) => {
    const type = msg.type()
    if (type !== 'error' && type !== 'warning') return
    logAudit({
      category: type === 'error' ? 'Console error' : 'Console warning',
      message: msg.text(),
      url: page.url(),
    })
  })

  page.on('pageerror', (error) => {
    logAudit({
      category: 'Uncaught pageerror',
      message: error?.message || String(error),
      url: page.url(),
      details: error?.stack || '',
    })
  })

  page.on('response', (response) => {
    const status = response.status()
    if (status < 400) return
    const url = response.url()
    // Ignore Vite/HMR noise.
    if (url.includes('/@vite') || url.includes('node_modules')) return
    logAudit({
      category: 'Failed network response',
      message: `${status} ${response.request().method()} ${url}`,
      url: page.url(),
    })
  })
}

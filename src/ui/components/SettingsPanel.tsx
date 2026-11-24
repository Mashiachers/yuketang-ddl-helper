import { useRef, useState } from 'react';
import { formatDateTime } from '../../core';
import type { DdlAppController } from '../hooks/useDdlApp';
import type { ResourceCenterController } from '../hooks/useResourceCenter';
import { ChevronDownIcon, FlaskIcon, HelpCircleIcon, RefreshIcon, UploadIcon } from './Icons';

const PLACEHOLDERS = [
  { token: '{{now}}', label: '当前时间' },
  { token: '{{tasks}}', label: '作业表格' },
  { token: '{{freeTimeNotes}}', label: '空闲时段' },
] as const;

export function SettingsPanel({
  app,
  rc,
}: {
  app: DdlAppController;
  rc?: ResourceCenterController;
}) {
  const [rawJson, setRawJson] = useState('');
  const [importing, setImporting] = useState(false);
  const templateRef = useRef<HTMLTextAreaElement | null>(null);

  const toggleReminder = (id: string) => {
    const next = app.settings.reminders.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    void app.updateSettings({ reminders: next });
  };

  const insertPlaceholderAtCursor = (token: string) => {
    const el = templateRef.current;
    const current = app.settings.customPromptTemplate;
    if (el) {
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      void app.updateSettings({ customPromptTemplate: next, promptPreset: 'custom' });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      const next = current ? `${current}\n${token}` : token;
      void app.updateSettings({ customPromptTemplate: next, promptPreset: 'custom' });
    }
  };

  const handleImport = async () => {
    if (!rawJson.trim()) return;
    setImporting(true);
    try {
      const ok = await app.importJson(rawJson);
      if (ok) setRawJson('');
    } finally {
      setImporting(false);
    }
  };

  const diagnostics = app.syncResult?.diagnostics;
  const hiddenCount = app.overrides.ignoredIds.length;

  return (
    <>
      <section className="ykt-section">
        <div className="ykt-section-title">常规设置</div>

        <div className="ykt-row">
          <div>
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>演示模式</div>
            <div className="ykt-section-desc">使用内置仿真课程数据体验功能，不读取真实账号</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="切换演示模式"
            aria-checked={app.settings.useDemoMode}
            className={`ykt-toggle${app.settings.useDemoMode ? ' on' : ''}`}
            onClick={() => void app.toggleDemoMode()}
          />
        </div>

        <div className="ykt-row">
          <div>
            <label htmlFor="ykt-cache-ttl" style={{ fontWeight: 600, fontSize: 12.5 }}>
              缓存有效期（分钟）
            </label>
            <div className="ykt-section-desc">减少频繁请求雨课堂接口，默认 15 分钟</div>
          </div>
          <input
            id="ykt-cache-ttl"
            type="number"
            min={1}
            max={180}
            className="ykt-input tabular"
            style={{ width: 72, textAlign: 'center' }}
            value={app.settings.cacheTtlMinutes}
            onChange={e => {
              const val = Math.max(1, Math.min(180, Number(e.target.value) || 15));
              void app.updateSettings({ cacheTtlMinutes: val });
            }}
          />
        </div>

        <div className="ykt-row">
          <div>
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>已隐藏任务</div>
            <div className="ykt-section-desc tabular">
              {hiddenCount > 0 ? `当前已隐藏 ${hiddenCount} 项任务` : '目前没有隐藏的任务'}
            </div>
          </div>
          <button
            type="button"
            className="ykt-btn ykt-btn-secondary ykt-btn-sm"
            disabled={hiddenCount === 0}
            onClick={() => void app.clearIgnored()}
          >
            恢复全部
          </button>
        </div>
      </section>

      <section className="ykt-section">
        <div className="ykt-section-title">
          <span>历史任务自动过滤</span>
          {app.hiddenByAgeCount > 0 && (
            <span className="ykt-tag tabular">已过滤 {app.hiddenByAgeCount} 项</span>
          )}
        </div>
        <div className="ykt-section-desc">
          自动屏蔽往年课程的陈旧记录，设为 0 表示不过滤。
        </div>

        <div className="ykt-row">
          <div>
            <label htmlFor="ykt-max-overdue-days" style={{ fontWeight: 600, fontSize: 12.5 }}>
              逾期超过（天）自动隐藏
            </label>
            <div className="ykt-section-desc">默认 100 天，避免往年已逾期作业刷屏</div>
          </div>
          <input
            id="ykt-max-overdue-days"
            type="number"
            min={0}
            max={3650}
            className="ykt-input tabular"
            style={{ width: 78, textAlign: 'center' }}
            value={app.settings.maxOverdueDays}
            onChange={e => {
              const raw = Number(e.target.value);
              const val = Number.isFinite(raw) ? Math.max(0, Math.min(3650, Math.floor(raw))) : 100;
              void app.updateSettings({ maxOverdueDays: val });
            }}
          />
        </div>

        <div className="ykt-row">
          <div>
            <label htmlFor="ykt-max-tbd-days" style={{ fontWeight: 600, fontSize: 12.5 }}>
              无截止且发布超过（天）隐藏
            </label>
            <div className="ykt-section-desc">默认 100 天，自动过滤往年未设截止的旧任务</div>
          </div>
          <input
            id="ykt-max-tbd-days"
            type="number"
            min={0}
            max={3650}
            className="ykt-input tabular"
            style={{ width: 78, textAlign: 'center' }}
            value={app.settings.maxTbdAgeDays}
            onChange={e => {
              const raw = Number(e.target.value);
              const val = Number.isFinite(raw) ? Math.max(0, Math.min(3650, Math.floor(raw))) : 100;
              void app.updateSettings({ maxTbdAgeDays: val });
            }}
          />
        </div>
      </section>

      <section className="ykt-section">
        <div className="ykt-section-title">
          <span>日历（.ics）三级提醒</span>
          <span
            className="ykt-help-icon"
            title="遵循 RFC 5545 标准并写入稳定去重 UID，重复导入 Google / Apple 日历会自动覆盖更新而不产生重复日程。"
          >
            <HelpCircleIcon size={14} />
          </span>
        </div>
        <div className="ykt-section-desc">
          导出后可直接导入 Google / Apple / 手机系统日历，重复导入自动覆盖不重复。
        </div>
        {app.settings.reminders.map(reminder => (
          <div key={reminder.id} className="ykt-row">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 12.5 }}>{reminder.label}</span>
              <span className="ykt-help-icon" title={`iCalendar 触发器：${reminder.trigger}`}>
                <HelpCircleIcon size={12} />
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={`开关${reminder.label}提醒`}
              aria-checked={reminder.enabled}
              className={`ykt-toggle${reminder.enabled ? ' on' : ''}`}
              onClick={() => toggleReminder(reminder.id)}
            />
          </div>
        ))}
      </section>

      <section className="ykt-section">
        <div className="ykt-section-title">
          <label htmlFor="ykt-custom-prompt">自定义 AI Prompt 模板</label>
        </div>
        <div className="ykt-section-desc">
          点击下方变量标签即可插入到光标处，留空则使用默认规划模板。
        </div>
        <div className="ykt-insert-chips">
          {PLACEHOLDERS.map(item => (
            <button
              key={item.token}
              type="button"
              className="ykt-insert-chip"
              title={`在光标处插入 ${item.label}（${item.token}）`}
              onClick={() => insertPlaceholderAtCursor(item.token)}
            >
              + {item.label} ({item.token})
            </button>
          ))}
        </div>
        <textarea
          ref={templateRef}
          id="ykt-custom-prompt"
          className="ykt-textarea"
          rows={4}
          placeholder="例如：请根据以下待办安排本周学习计划：\n{{tasks}}\n我的空闲时间：{{freeTimeNotes}}"
          value={app.settings.customPromptTemplate}
          onChange={e => void app.updateSettings({ customPromptTemplate: e.target.value })}
        />
      </section>

      <section className="ykt-section">
        <button
          type="button"
          className="ykt-collapsible-trigger"
          aria-expanded={app.advancedOpen}
          onClick={() => app.setAdvancedOpen(!app.advancedOpen)}
        >
          <span>高级与诊断（接口排查 / 手动导入 JSON）</span>
          <ChevronDownIcon size={16} className={`ykt-chevron${app.advancedOpen ? ' open' : ''}`} />
        </button>

        {app.advancedOpen && (
          <div className="ykt-collapsible-body">
            <div>
                <div className="ykt-section-title" style={{ marginBottom: 6 }}>
                <span>平台与接口诊断（已脱敏）</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="ykt-link-btn"
                    title="复制接口返回的脱敏状态/时间字段样本，便于排查已交卷未识别等问题"
                    onClick={() => void app.copyStatusHintSample()}
                  >
                    复制状态字段样本
                  </button>
                  <button
                    type="button"
                    className="ykt-link-btn"
                    disabled={app.loading}
                    onClick={() => void app.syncNow({ force: true })}
                  >
                    <RefreshIcon size={12} className={app.loading ? 'ykt-spin' : undefined} /> 重新探测
                  </button>
                </div>
              </div>
              <div className="ykt-section-desc tabular">
                当前识别：{app.platform.label}（<span className="ykt-code-chip">{app.platform.host}</span> · xtbz=
                <span className="ykt-code-chip">{app.platform.xtbz}</span>）
                {app.syncResult && <> · 最近同步：{formatDateTime(app.syncResult.syncedAt)}</>}
              </div>

              {diagnostics && diagnostics.endpoints.length > 0 ? (
                <table className="ykt-diag-table tabular" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>作用域</th>
                      <th>端点</th>
                      <th>结果</th>
                      <th>耗时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostics.endpoints.slice(-12).map((ep, idx) => (
                      <tr key={`${ep.endpoint}-${idx}`}>
                        <td>{ep.scope}</td>
                        <td style={{ wordBreak: 'break-all', maxWidth: 185 }}>{ep.endpoint}</td>
                        <td>
                          {ep.outcome}
                          {ep.status ? ` (${ep.status})` : ''}
                        </td>
                        <td>{ep.durationMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="ykt-section-desc" style={{ marginTop: 6 }}>
                  {app.syncResult?.source === 'demo'
                    ? '当前处于演示模式，未发起真实网络请求。'
                    : '暂无接口探测记录，点击刷新后可查看。'}
                </div>
              )}
            </div>

            {rc && (
              <div className="ykt-diag-divider">
                <div className="ykt-section-title" style={{ marginBottom: 6 }}>
                  <span>课程资源索引与接口诊断（v0.2）</span>
                  <button
                    type="button"
                    className="ykt-link-btn"
                    disabled={rc.loading || rc.clearingIndex}
                    onClick={() => void rc.refreshResources(true)}
                  >
                    <RefreshIcon size={12} className={rc.loading ? 'ykt-spin' : undefined} /> 刷新资源探测
                  </button>
                </div>

                <div className="ykt-diag-chips tabular">
                  <span className="ykt-tag">已索引 {rc.syncStatus?.knownMaterials ?? rc.materials.length} 份</span>
                  <span className="ykt-tag">已下载 {rc.syncStatus?.downloadedMaterials ?? rc.stats.downloadedCount} 份</span>
                  {(rc.syncStatus?.failedMaterials ?? rc.stats.failedCount) > 0 && (
                    <span className="ykt-tag ykt-status-pill status-failed">
                      失败 {rc.syncStatus?.failedMaterials ?? rc.stats.failedCount} 份
                    </span>
                  )}
                  {rc.syncedAt && Number.isFinite(Date.parse(rc.syncedAt)) && (
                    <span className="ykt-tag">同步于 {formatDateTime(Date.parse(rc.syncedAt))}</span>
                  )}
                </div>

                <button
                  type="button"
                  className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                  disabled={rc.loading || rc.clearingIndex || rc.busyMode !== null}
                  onClick={() => {
                    if (window.confirm('清空当前站点和模式的资源索引及下载记录？已保存的文件会保留。')) {
                      void rc.clearResourceIndex();
                    }
                  }}
                >
                  {rc.clearingIndex ? '正在清空…' : '清空资源索引'}
                </button>
                {rc.notice && (
                  <div className={`ykt-banner ${rc.notice.tone}`} role="status">
                    {rc.notice.text}
                  </div>
                )}

                {rc.diagnostics.length > 0 ? (
                  <table className="ykt-diag-table tabular" style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>作用域</th>
                        <th>端点</th>
                        <th>结果</th>
                        <th>耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rc.diagnostics.slice(-12).map((ep, idx) => (
                        <tr key={`${ep.endpoint}-${ep.scope}-${idx}`}>
                          <td>{ep.scope}</td>
                          <td style={{ wordBreak: 'break-all', maxWidth: 185 }}>
                            <div>{ep.endpoint}</div>
                            {ep.experimental && (
                              <span className="ykt-tag ykt-tag-exp" style={{ marginTop: 3 }}>
                                <FlaskIcon size={9} /> 实验接口
                              </span>
                            )}
                            {ep.note && (
                              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                                {ep.note}
                              </div>
                            )}
                          </td>
                          <td>
                            {ep.outcome}
                            {ep.status ? ` (${ep.status})` : ''}
                            {typeof ep.itemCount === 'number' ? ` · ${ep.itemCount}` : ''}
                          </td>
                          <td>{ep.durationMs}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="ykt-section-desc" style={{ marginTop: 6 }}>
                    暂无课程资源接口诊断记录，切换至「课程资源」或点击「刷新资源探测」后显示。
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="ykt-raw-json" style={{ fontWeight: 700, fontSize: 12 }}>
                手动导入雨课堂 JSON（兜底解析）
              </label>
              <div className="ykt-section-desc">
                若高校定制分支接口结构变动，可从浏览器 DevTools Network 复制响应 JSON 粘贴解析。
              </div>
              <textarea
                id="ykt-raw-json"
                className="ykt-textarea"
                rows={3}
                placeholder='粘贴课程作业 JSON 数组或接口响应体，如 {"data":{"activities":[...]}}'
                value={rawJson}
                onChange={e => setRawJson(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                  disabled={!rawJson.trim() || importing}
                  onClick={() => void handleImport()}
                >
                  <UploadIcon size={13} /> 解析并加载到看板
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

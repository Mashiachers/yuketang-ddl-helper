import { useMemo, useState } from 'react';
import type { PromptPresetId } from '../../types';
import type { DdlAppController } from '../hooks/useDdlApp';
import { estimateTokens } from '../utils/format';
import { SparklesIcon } from './Icons';
import { MarkdownPreview } from './MarkdownPreview';

const PRESET_CARDS: Array<{ id: PromptPresetId; name: string; hint: string }> = [
  { id: 'weekly-plan', name: '本周全盘规划', hint: '分级估时 + 每日排期 + 答题框架' },
  { id: 'emergency-48h', name: '48h 冲刺急救', hint: '聚焦高危任务与最小可交付物' },
  { id: 'concise-checklist', name: '极简执行清单', hint: '按 DDL 排序的一句话下一步' },
  { id: 'custom', name: '自定义模板', hint: '使用你在设置中编写的 Prompt' },
];

export function PromptPanel({ app }: { app: DdlAppController }) {
  const [previewMode, setPreviewMode] = useState<'rendered' | 'source'>('rendered');
  const targetCount = app.selectedItems.length || app.filteredItems.length;

  const { charCount, tokenCount } = useMemo(
    () => ({
      charCount: app.promptPreviewText.length,
      tokenCount: estimateTokens(app.promptPreviewText),
    }),
    [app.promptPreviewText],
  );

  return (
    <>
      <section className="ykt-section">
        <div className="ykt-section-title">
          <span>选择 AI 提示词策略</span>
          <span className="ykt-tag tabular">已打包 {targetCount} 项</span>
        </div>
        <div className="ykt-preset-grid" role="radiogroup" aria-label="AI 提示词策略">
          {PRESET_CARDS.map(card => {
            const active = app.settings.promptPreset === card.id;
            return (
              <button
                key={card.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`ykt-preset-card${active ? ' active' : ''}`}
                onClick={() => void app.updateSettings({ promptPreset: card.id })}
              >
                <span className="ykt-radio-dot" aria-hidden="true" />
                <div>
                  <div className="ykt-preset-name">{card.name}</div>
                  <div className="ykt-preset-hint">{card.hint}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="ykt-section">
        <div className="ykt-section-title">
          <label htmlFor="ykt-free-time-notes">个人空闲时段备注（可选）</label>
        </div>
        <div className="ykt-section-desc">
          填上你本周的整块空闲时间，粘贴给 Gemini / ChatGPT 后可直接帮你把作业排进空档。
        </div>
        <textarea
          id="ykt-free-time-notes"
          className="ykt-textarea"
          rows={3}
          placeholder="例如：周三下午 14:00-17:30 无课；周四晚 19:00-22:00 在图书馆；周五上午满课。"
          value={app.settings.freeTimeNotes}
          onChange={e => void app.updateSettings({ freeTimeNotes: e.target.value })}
        />
      </section>

      <section className="ykt-section">
        <div className="ykt-section-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <SparklesIcon size={14} /> Prompt 预览
          </span>
          <div className="ykt-view-switch" role="tablist" aria-label="预览模式">
            <button
              type="button"
              role="tab"
              aria-selected={previewMode === 'rendered'}
              className={`ykt-view-switch-btn${previewMode === 'rendered' ? ' active' : ''}`}
              onClick={() => setPreviewMode('rendered')}
            >
              渲染
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={previewMode === 'source'}
              className={`ykt-view-switch-btn${previewMode === 'source' ? ' active' : ''}`}
              onClick={() => setPreviewMode('source')}
            >
              源码
            </button>
          </div>
        </div>

        <div className="ykt-section-desc tabular">
          共 {charCount} 字 · 预估约 {tokenCount} tokens
        </div>

        <div className="ykt-prompt-box">
          {previewMode === 'rendered' ? (
            <MarkdownPreview content={app.promptPreviewText} />
          ) : (
            <pre className="ykt-prompt-source">{app.promptPreviewText}</pre>
          )}
        </div>
      </section>
    </>
  );
}

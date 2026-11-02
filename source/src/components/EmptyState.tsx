import { IconInbox, IconPlus, IconSearch } from './Icons'

export function EmptyState({
  kind,
  onNew,
  query,
}: {
  kind: 'filtered' | 'search'
  onNew: () => void
  query?: string
}) {
  return (
    <div className="glass animate-fade-up flex flex-col items-center justify-center rounded-[24px] px-6 py-16 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {kind === 'search' ? <IconSearch size={24} /> : <IconInbox size={24} />}
      </span>
      <h3 className="mt-4 font-display text-[19px] font-bold t1">
        {kind === 'search' ? '没有匹配的任务' : '这里空空如也'}
      </h3>
      <p className="mt-1.5 max-w-sm text-[14px] t2">
        {kind === 'search'
          ? `没有找到包含「${query}」的任务，换个关键词试试。`
          : '换个筛选条件，或者创建一个新任务开始计时。'}
      </p>
      {kind === 'filtered' && (
        <button className="btn btn-primary mt-5 !rounded-2xl !px-5" onClick={onNew}>
          <IconPlus size={17} />
          新建任务
        </button>
      )}
    </div>
  )
}

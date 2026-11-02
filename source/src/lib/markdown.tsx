import type { ReactNode } from 'react'

/* --------------------------------------------------------------------------
   轻量 Markdown 渲染器
   只支持笔记常用的语法（标题 / 列表 / 引用 / 代码 / 图片 / 链接 / 加粗斜体），
   产物是 React 节点而非 HTML 字符串——天然转义，无 XSS 风险，也不引入第三方依赖。
   -------------------------------------------------------------------------- */

function safeUrl(url: string, kind: 'img' | 'link'): string | null {
  const u = url.trim()
  if (kind === 'img') {
    if (/^data:image\//i.test(u)) return u
    if (/^https?:\/\//i.test(u)) return u
    return null
  }
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u
  return null
}

const INLINE_RE =
  /(!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('![')) {
      const mm = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(tok)
      const src = mm ? safeUrl(mm[2], 'img') : null
      out.push(
        src ? (
          <img
            key={key}
            src={src}
            alt={mm ? mm[1] : ''}
            loading="lazy"
            className="my-1.5 max-h-[440px] w-auto max-w-full rounded-xl border border-line"
          />
        ) : (
          tok
        )
      )
    } else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
      const href = mm ? safeUrl(mm[2], 'link') : null
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--accent)] underline underline-offset-2"
          >
            {mm ? mm[1] : tok}
          </a>
        ) : (
          tok
        )
      )
    } else if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-[0.85em] t1">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(
        <strong key={key} className="font-bold t1">
          {tok.slice(2, -2)}
        </strong>
      )
    } else {
      out.push(
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const HEADING_CLASS = [
  'text-[22px]',
  'text-[19px]',
  'text-[17px]',
  'text-[15.5px]',
  'text-[14.5px]',
  'text-[14px]',
]

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    const fence = /^```(.*)$/.exec(line)
    if (fence) {
      const lang = fence[1].trim()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i])
        i += 1
      }
      i += 1
      nodes.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-xl border border-line bg-surface p-3"
        >
          <code className="font-mono text-[13px] t1" data-lang={lang || undefined}>
            {buf.join('\n')}
          </code>
        </pre>
      )
      continue
    }

    if (!line.trim()) {
      i += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = Math.min(6, heading[1].length)
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      nodes.push(
        <Tag key={key++} className={`mb-1.5 mt-3 font-display font-bold t1 ${HEADING_CLASS[level - 1]}`}>
          {renderInline(heading[2], `h${key}`)}
        </Tag>
      )
      i += 1
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      nodes.push(<hr key={key++} className="my-3 border-line" />)
      i += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i += 1
      }
      nodes.push(
        <blockquote
          key={key++}
          className="my-2 border-l-2 border-[var(--accent)] bg-surface py-1 pl-3 pr-2 t2"
        >
          {renderInline(buf.join(' '), `bq${key}`)}
        </blockquote>
      )
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i += 1
      }
      nodes.push(
        <ul key={key++} className="my-1.5 list-disc space-y-1 pl-5 t1">
          {items.map((it, n) => (
            <li key={n}>{renderInline(it, `ul${key}-${n}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
        i += 1
      }
      nodes.push(
        <ol key={key++} className="my-1.5 list-decimal space-y-1 pl-5 t1">
          {items.map((it, n) => (
            <li key={n}>{renderInline(it, `ol${key}-${n}`)}</li>
          ))}
        </ol>
      )
      continue
    }

    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      buf.push(lines[i])
      i += 1
    }
    const parts: ReactNode[] = []
    buf.forEach((l, n) => {
      if (n > 0) parts.push(<br key={`br${n}`} />)
      parts.push(...renderInline(l, `p${key}-${n}`))
    })
    nodes.push(
      <p key={key++} className="my-1.5 leading-relaxed t1">
        {parts}
      </p>
    )
  }

  return nodes
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return <p className={className} />
  return <div className={className}>{parseBlocks(text)}</div>
}

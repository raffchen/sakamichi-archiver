import { describe, expect, it } from 'vitest'
import { normalizeBlogContent } from './blog-html'

/* Blog bodies arrive in several shapes from the official API (even within one
   member's archive). normalizeBlogContent must turn every <br>-separated run
   into a block element — Google Translate drops <br>s and would otherwise
   collapse the whole body into one paragraph — while leaving line-per-<div>
   bodies untouched. Shapes below are modeled on real posts (幸阪_茉里乃
   #70460, 遠藤_光莉 #71869, 与田_祐希 #63012/#57585, 伊藤_理々杏 #45209). */

describe('normalizeBlogContent', () => {
  it('returns content with no <br> as the identical string', () => {
    const html = '<div>おはよう📚</div><div dir="auto">今日もよろしくね</div>'
    expect(normalizeBlogContent(html)).toBe(html)
    expect(normalizeBlogContent('<p>just one line</p>')).toBe('<p>just one line</p>')
    expect(normalizeBlogContent('')).toBe('')
  })

  it('splits a big <p> with <br> lines into one block per line', () => {
    expect(normalizeBlogContent('<p>line1<br/>line2<br />line3</p>')).toBe(
      '<div>line1</div><div>line2</div><div>line3</div>'
    )
  })

  it('keeps blank lines as <div><br></div> spacers and drops the trailing one', () => {
    // 遠藤_光莉 #71869 shape: leading <br>s and a trailing <br>
    expect(normalizeBlogContent('<p><br/><br/>ブログを開いて下さり、ありがとうございます。<br/>光莉🦋<br/></p>')).toBe(
      '<div><br></div><div><br></div><div>ブログを開いて下さり、ありがとうございます。</div><div>光莉🦋</div>'
    )
    expect(normalizeBlogContent('<p>a<br><br>b</p>')).toBe(
      '<div>a</div><div><br></div><div>b</div>'
    )
  })

  it('splits raw br-separated text and keeps images as their own block', () => {
    // 与田_祐希 #63012 shape: no wrapper at all
    expect(normalizeBlogContent('出会えてよかった、これからもよろしくね☺︎<br><img src="files/01JH.jpg"><br><br>またね')).toBe(
      '<div>出会えてよかった、これからもよろしくね☺︎</div><img src="files/01JH.jpg"><div><br></div><div><br></div><div>またね</div>'
    )
  })

  it('does not invent blank lines around standalone block images', () => {
    // 'text<br><img><br>more' — the img must not flush an empty run into a spacer
    expect(normalizeBlogContent('a<br><img src="x.jpg">b')).toBe(
      '<div>a</div><img src="x.jpg"><div>b</div>'
    )
  })

  it('leaves div-format bodies (line per <div>) structurally intact', () => {
    // 幸阪_茉里乃 #70460 shape — the <br> here only spacers after an image
    const html =
      '<div dir="auto">皆さん、こんにちは！</div>' +
      '<div dir="auto"><div><img src="/media/x.jpg" style="width: 844px;"></div><br></div>' +
      '<div dir="auto">今回はブルーの浴衣にしてみました🫐</div>'
    const out = normalizeBlogContent(html)
    expect(out).toContain('<div dir="auto">皆さん、こんにちは！</div>')
    expect(out).toContain('<div dir="auto">今回はブルーの浴衣にしてみました🫐</div>')
    expect(out).toContain('<div><img src="/media/x.jpg" style="width: 844px;"></div><div><br></div>')
  })

  it('splits lines nested inside divs (gmail-style quotes)', () => {
    const out = normalizeBlogContent(
      '<div class="gmail_quote"><div><div class="gmail_quote"><div>quoted<br>lines</div></div></div></div>after'
    )
    expect(out).toContain('<div>quoted</div><div>lines</div>')
    expect(out).toContain('<div>after</div>')
  })

  it('dissolves inline elements that carry <br>', () => {
    expect(normalizeBlogContent('<div><span>a<br>b</span></div>')).toBe('<div>a</div><div>b</div>')
  })

  it('keeps inline elements without <br> inside their run', () => {
    expect(normalizeBlogContent('see <a href="https://x.co">link</a><br>bye')).toBe(
      '<div>see <a href="https://x.co">link</a></div><div>bye</div>'
    )
  })

  it('unwraps legacy full <html> documents', () => {
    // 伊藤_理々杏 #45209 shape
    const out = normalizeBlogContent(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body><div>こんにちは～！！</div><div>&nbsp;</div><div>伊藤理々杏です</div></body></html>'
    )
    expect(out).not.toMatch(/<(html|head|body|meta)[\s>]/i)
    expect(out).toContain('<div>こんにちは～！！</div>')
    expect(out).toContain('<div>伊藤理々杏です</div>')
  })

  it('escapes text when rebuilding blocks', () => {
    // content arrives pre-escaped from the API; rebuilding must keep it escaped
    expect(normalizeBlogContent('a &amp; b &lt;3<br>c &gt; d')).toBe(
      '<div>a &amp; b &lt;3</div><div>c &gt; d</div>'
    )
  })

  it('treats runs of empty inline elements as blank lines (span-per-line shape)', () => {
    // 大園_玲 #36969 shape: every line is a <span>, blank lines are empty spans
    const html = '<div><br/><span></span><br/><span>画面越しだけど</span><br/><span></span><br/><span>もう会っちゃった気です</span></div>'
    expect(normalizeBlogContent(html)).toBe(
      '<div><br></div><div><br></div><div><span>画面越しだけど</span></div><div><br></div><div><span>もう会っちゃった気です</span></div>'
    )
  })

  it('keeps elements with real content even when their text is empty', () => {
    // the <br> after the image span just ends that line — no extra blank
    expect(normalizeBlogContent('a<br><span><img src="x.jpg"></span><br>b')).toBe(
      '<div>a</div><div><span><img src="x.jpg"></span></div><div>b</div>'
    )
  })

  it('strips upstream full-bleed margins from images (renders fitted + centered)', () => {
    // 大園_玲 #36969 shape: Apple edge-to-edge export shifts photos 24px left
    const out = normalizeBlogContent(
      '<div><span style="-webkit-text-size-adjust: auto;">文字</span><br/><img src="files/x.jpg" style="-webkit-text-size-adjust: auto; width: calc(100% + 48px); margin-left: -24px;"><br/></div>'
    )
    expect(out).toContain('<img src="files/x.jpg" style="-webkit-text-size-adjust: auto; width: calc(100% + 48px)">')
    expect(out).not.toContain('margin')
  })

  it('strips margins from pure image wrappers too, keeps text margins', () => {
    // 与田_祐希-era shape: wrapper span carries the full-bleed shift
    const out = normalizeBlogContent(
      '<span style="width: calc((100% + 20px) + 20px); margin-left: -20px;"><img src="files/y.jpg"></span>' +
        '<div style="margin: 9px 0px 8px;">テキスト</div>'
    )
    expect(out).toContain('<div><span style="width: calc((100% + 20px) + 20px)"><img src="files/y.jpg"></span></div>')
    expect(out).toContain('<div style="margin: 9px 0px 8px;">テキスト</div>')
  })

  it('strips margins even when there is no <br> (fast-path must not skip it)', () => {
    const html = '<div><img src="files/z.jpg" style="margin-left: -24px; width: calc(100% + 48px)"></div>'
    expect(normalizeBlogContent(html)).toBe('<div><img src="files/z.jpg" style="width: calc(100% + 48px)"></div>')
  })

  it('drops dead dcimg.awalker.jp images (host is offline)', () => {
    expect(normalizeBlogContent('今日の一枚<br><img src="http://dcimg.awalker.jp/view2.php?u=abc123"><br>またね')).toBe(
      '<div>今日の一枚</div><div>またね</div>'
    )
  })

  it('unwraps anchors to the dead host, keeping their label text', () => {
    expect(normalizeBlogContent('写真↑<br><a href="http://dcimg.awalker.jp/view2.php?u=abc">もっと見る</a><br>バイバイ')).toBe(
      '<div>写真↑</div><div>もっと見る</div><div>バイバイ</div>'
    )
  })

  it('removes an anchor+img pair to the dead host entirely', () => {
    expect(normalizeBlogContent('<a href="http://dcimg.awalker.jp/x"><img src="http://dcimg.awalker.jp/x"></a>おわり')).toBe(
      '<div>おわり</div>'
    )
  })

  it('keeps live images and other links untouched', () => {
    expect(normalizeBlogContent('<a href="https://example.com">link</a><br><img src="files/ok.jpg">')).toBe(
      '<div><a href="https://example.com">link</a></div><img src="files/ok.jpg">'
    )
  })

  it('strips dead images even when there is no <br> (fast-path must not skip it)', () => {
    expect(normalizeBlogContent('<div><img src="https://dcimg.awalker.jp/view2.php?u=abc"></div>')).toBe('<div></div>')
  })

  it('is idempotent', () => {
    const samples = [
      '<p><br/><br/>ブログを開いて下さり、ありがとうございます。<br/>光莉🦋<br/></p>',
      '<div dir="auto"><div><img src="/media/x.jpg"></div><br></div><div>またね</div>',
      'a<br><br><img src="x.jpg"><br>b',
    ]
    for (const s of samples) {
      expect(normalizeBlogContent(normalizeBlogContent(s))).toBe(normalizeBlogContent(s))
    }
  })
})

describe('dark inline text colors', () => {
  it('strips black inline colors (中村_麗乃 #102433: style="color:#000")', () => {
    expect(normalizeBlogContent('<div><span style="color:#000">text</span></div>')).toBe(
      '<div><span>text</span></div>'
    )
  })

  it('strips the dark-gray palette, hex/rgb forms and !important variants', () => {
    expect(normalizeBlogContent('<div><span style="color: rgb(49,49,49)">a</span></div>')).toBe(
      '<div><span>a</span></div>'
    )
    expect(normalizeBlogContent('<div><span style="color:#000000">a</span></div>')).toBe(
      '<div><span>a</span></div>'
    )
    expect(normalizeBlogContent('<div><span style="color:#454545!important">a</span></div>')).toBe(
      '<div><span>a</span></div>'
    )
    expect(normalizeBlogContent('<div><span style="color:rgba(0,0,0,0.87)">a</span></div>')).toBe(
      '<div><span>a</span></div>'
    )
    expect(normalizeBlogContent('<div><span style="color:#333">a</span></div>')).toBe(
      '<div><span>a</span></div>'
    )
  })

  it('keeps colorful accents, whites and unresolvable values', () => {
    expect(normalizeBlogContent('<div><span style="color:#4285f4">a</span></div>')).toBe(
      '<div><span style="color:#4285f4">a</span></div>'
    )
    expect(normalizeBlogContent('<div><span style="color:#fff">a</span></div>')).toBe(
      '<div><span style="color:#fff">a</span></div>'
    )
    expect(normalizeBlogContent('<div><span style="color:var(--x)">a</span></div>')).toBe(
      '<div><span style="color:var(--x)">a</span></div>'
    )
    expect(normalizeBlogContent('<div><span style="color:currentcolor">a</span></div>')).toBe(
      '<div><span style="color:currentcolor">a</span></div>'
    )
  })

  it('keeps background-color and other declarations; drops styles left empty', () => {
    expect(normalizeBlogContent('<div><span style="background-color:#000;color:#000">a</span></div>')).toBe(
      '<div><span style="background-color:#000">a</span></div>'
    )
    expect(normalizeBlogContent('<div><span style="margin:10px;color:#000">a</span></div>')).toBe(
      '<div><span style="margin:10px">a</span></div>'
    )
  })

  it('the fast path no longer skips posts whose only special case is a color', () => {
    // no <br>, no margins, not legacy — the color must still be stripped
    expect(normalizeBlogContent('<div>line</div><span style="color:#000">x</span>')).toBe(
      '<div>line</div><div><span>x</span></div>'
    )
  })

  it('is idempotent', () => {
    const once = normalizeBlogContent(
      '<span style="color:#000">a</span><span style="color:#4285f4">b</span>'
    )
    expect(normalizeBlogContent(once)).toBe(once)
  })
})

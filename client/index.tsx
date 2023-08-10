import type { highlightElement as HighlightElement } from 'prismjs'
import m from 'mithril'
import {cc} from 'mithril-cc'

const PAGE_REGEX = /^\/npm\/((?:@[^@\/]+\/)?[^@\/]+)(?:@([^\/]+))?\/?(.*)$/;

const PrismPromise = new Promise<{ highlightElement: typeof HighlightElement }>(resolve => {
  ;(window as any).resolvePrism = resolve
})


type Pkg = {
  name: string
  version: string
  file: string
}

type Route =
| { name: 'loading' }
| { name: 'home' }
| { name: 'file', pkg: Pkg }
| { name: 'dir', pkg: Pkg }
| { name: '404' }

const AppComponent = cc(function() {
  let route: Route = { name: 'loading' }

  this.oncreate(async () => {
    const pagePath = window.location.pathname
    const match = pagePath.match(PAGE_REGEX)

    if (pagePath === '/') {
      route = { name: 'home' }
    }
    else if (match) {
      let pkg = {
        name: match[1],                 // e.g. "mithril" or "@openzeppelin/contracts"
        version: match[2] || 'latest',  // e.g. "4.9.3"
        file: "/" + (match[3] || ""),   // e.g. "/contracts/governance/Governor.sol"
      }

      if (pkg.version === 'latest') {
        try {        
          const info = await (await fetch(`https://registry.npmjs.com/${pkg.name}/${pkg.version}`)).json()
          pkg.version = info.version
        }
        catch {
          route = { name: '404' }
          return
        }
      }

      const fullPath = pkgToAppPath(pkg)
      if (pagePath !== fullPath) {
        window.history.replaceState(null, '', fullPath)
      }

      route = pkg.file.endsWith('/')
        ? { name: 'dir', pkg }
        : { name: 'file', pkg }
    }
    m.redraw()
  })

  return () => (
    route.name === 'loading'
    ? Loading()
    : route.name === 'home'
    ? Home()
    : route.name === 'file'
    ? m(FileComponent, { pkg: route.pkg })
    : route.name === 'dir'
    ? <div>TODO</div>
    : NotFound()
  )
})


type FileComponentAttrs = {
  pkg: Pkg
}
const FileComponent = cc<FileComponentAttrs>(function ($attrs) {
  // Convoluted but avoids 3rd party libraries
  let setCode: (code: string) => void
  let code = ''
  let codePromise = new Promise<string>(resolve => {
    setCode = (result: string) => {
      resolve(result)
      code = result
    }
  })
  let lang = $attrs().pkg.file.match(/\.([a-z]+)$/)?.[1] || 'txt'

  let lineCount = 0
  let firstRender = true
  let [highlightLineStart, highlightLineEnd] = [0,0]

  updateLineHighlights()

  this.addEventListener(window, 'hashchange', () => {
    updateLineHighlights()
  })

  function updateLineHighlights() {
    const hash = window.location.hash
    if (hash.startsWith('#L')) {
      // Line numbers
      let [, start, end] = window.location.hash.match(/^#L(\d+)(?:-L?(\d+))?$/) || []
      highlightLineStart = start ? parseInt(start, 10) : 0
      highlightLineEnd = end ? parseInt(end, 10) : 0
    }
    else if (hash.startsWith('#C') && code) {
      // Character numbers
      let [, start, end] = window.location.hash.match(/^#C(\d+)(?:-C?(\d+))?$/)?.map(s => +s) || []

      if (!start) return
      if (!end) end = start

      let index = 0
      let lineStart = 0
      for (; index < code.length && index < start; index++) {
        if (code[index] === '\n') {
          lineStart++
        }
      }
      let lineEnd = lineStart
      for (; index < code.length && index < end; index++) {
        if (code[index] === '\n') {
          lineEnd++
        }
      }
      highlightLineStart = lineStart + 1
      highlightLineEnd = lineEnd + 1
    }
  }


  async function setCodeElem(codeElem: HTMLElement) {
    codeElem.innerText = await codePromise
  }


  this.oncreate(async ({ dom }) => {
    const codeElem = dom.querySelector('.Code')! as HTMLElement
    const { pkg } = $attrs()

    // Render asap
    const codeRaw = await (await fetch(pkgToCdnUrl('jsdelivr', pkg))).text()
    setCode(codeRaw)
    lineCount = codeRaw.split('\n').length
    updateLineHighlights()
    m.redraw()

    // Highlight after
    const Prism = await PrismPromise
    Prism.highlightElement(codeElem)
  })


  function onLineNumClick(e: MouseEvent) {
    const target = e.target as HTMLElement

    if (!target.classList.contains('line')) return

    e.preventDefault()

    if (e.shiftKey && highlightLineStart) {
      let [startNum, endNum] = [highlightLineStart, +target.innerText].sort((a,b) => a - b)
      const newHash = `#L${startNum}-${endNum}`
      // Push new window state with new hash, keeping pathname and url parameters intact
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${newHash}`)

      // hashchange doesn't emit when we do that, so update manually
      updateLineHighlights()
    }
    else if (!e.shiftKey) {
      const newHash = `#L${target.innerText}`
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${newHash}`)

      // hashchange doesn't emit when we do that, so update manually
      updateLineHighlights()
    }
  }


  return ({ pkg }) => {
    return Layout(
      <div class="py-2">
        <div class="max-w-4xl mx-auto">
          <div class="pb-2 px-2 border-b border-[#c7cbbe] dark:border-[#192024]">
            <a
              href={`https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`}
              class="hover:underline"
            >
              {pkg.name}
            </a>
          </div>
          <div class="pb-2 px-2 border-b border-[#c7cbbe] dark:border-[#192024]">└─ {pkg.file.replace(/^\//, '')}</div>

          {lineCount > 0 &&
            <div oncreate={() => {
              // Abuse lifecycle to guarantee entrypoint after code is rendered
              if (firstRender && highlightLineStart) {
                const el = document.getElementById(`L${highlightLineStart}`)
                if (!el) return

                const rect = el.getBoundingClientRect()

                window.scrollTo({
                  top: rect.top + window.pageYOffset - 20 /* some padding */,
                  left: rect.left + window.pageXOffset,
                })
              }
            }}></div>
          }

          <div class="CodeBox relative flex">
            <div onclick={onLineNumClick} class="pt-2 px-2 border-r border-[#c7cbbe] dark:border-[#192024] text-right text-[#a0a691] dark:text-[#394146]">
              {lineCount > 0 && new Array(lineCount).fill(0).map((_, i) => {
                const shouldHighlight = !!highlightLineStart && !!(
                  !highlightLineEnd && i+1 === highlightLineStart ||
                  highlightLineEnd && i+1 >= highlightLineStart && i+1 <= highlightLineEnd
                )

                return (
                  <div key={`L${i+1}`} class={`${shouldHighlight ? 'highlight' : ''}`}>
                    <a class='line' id={`L${i+1}`} href={`#L${i+1}`}>{i+1}</a>
                  </div>
                )
              })}
            </div>
            <div class="pt-2 px-2 flex-1 overflow-x-auto dark:bg-[#13181b]">
              <pre>
                <code
                  oncreate={({ dom }) => setCodeElem(dom as HTMLElement)}
                  class={`Code language-${lang || 'text'}`}
                ></code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    )
  }
})



function Layout(content: JSX.Element) {
  return <div>
    <div class="p-2">
      <div class="">
        <a href="/" class="hover:underline">pkg.link</a>
      </div>
    </div>

    {content}
  </div>
}

function Loading() {
  return Layout(
    <div class="pt-32 px-4 flex-center">
      <div class="mt-6 text-base sm:text-xl text-center animate-bounce">Loading...</div>
    </div>
  )
}

function Home() {
  return Layout(
    <div class="pt-32 px-4 flex-center">
      <div class="text-3xl sm:text-4xl text-center leading-snug">
        <span class="text-[#5177b8]">pkg.link</span> lets you <span class="text-[#5177b8]">permalink</span>
        <br />to package source code
      </div>
      <div class="mt-6 text-base sm:text-xl text-center">That's it. That's the app.</div>
    </div>
  )
}

function NotFound() {
  return Layout(
    <div class="pt-32 px-4 flex-center">
      <div class="text-3xl sm:text-4xl text-center leading-snug">
        Page not found.
      </div>
      <div class="mt-6 text-base sm:text-xl text-center">Try double checking your url ☝️</div>
    </div>
  )
}

m.mount(document.getElementById('app')!, AppComponent)

//
// Helpers
//
function pkgToAppPath(pkg: Pkg) {
  return `/npm/${pkg.name}@${pkg.version}${pkg.file || ''}`
}

function pkgToCdnUrl(cdn: 'jsdelivr', pkg: Pkg) {
  if (cdn === 'jsdelivr') {
    return `https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}${pkg.file}`
  }
  throw new Error(`CDN not recognized: ${cdn}`)
}

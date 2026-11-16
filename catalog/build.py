import asyncio, os, re, zipfile, json, base64, io, html, sys
from playwright.async_api import async_playwright
from PIL import Image
SE='/home/claude/se'; OUT='/home/claude/se-build/out'
items=[l.split() for l in open(SE+'/list.txt') if l.strip()]
def text_of(x): return re.sub(r'<[^>]+>',' ',x)
async def render(pg, svgpath, w, h):
    data=open(svgpath,'rb').read().decode('utf-8')
    await pg.set_viewport_size({"width":w,"height":h})
    await pg.set_content(f'<html><body style="margin:0;background:#fff">{data[data.index("<svg"):]}</body></html>')
    await pg.evaluate(f"(()=>{{const s=document.querySelector('svg');s.setAttribute('width','{w}');s.setAttribute('height','{h}');s.setAttribute('preserveAspectRatio','xMidYMid meet');s.style.display='block'}})()")
    await pg.wait_for_timeout(150)
    return await pg.screenshot(type='png')
async def main():
    meta=[]
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"]); pg=await b.new_page()
        for slug,lvl in items:
            src=f'{SE}/{slug}/src'; ep=src+'/epub'
            opf=open(ep+'/content.opf',encoding='utf-8').read()
            title=html.unescape(re.search(r'<dc:title[^>]*>(.*?)</dc:title>',opf).group(1))
            author=html.unescape(re.search(r'<dc:creator[^>]*>(.*?)</dc:creator>',opf).group(1))
            desc=html.unescape(re.search(r'<dc:description[^>]*>(.*?)</dc:description>',opf,re.S).group(1)) if '<dc:description' in opf else ''
            files={}
            words=0
            for root,_,fs in os.walk(src):
                for f in fs:
                    full=os.path.join(root,f); rel=os.path.relpath(full,src)
                    files[rel]=open(full,'rb').read()
            for rel,d in files.items():
                if rel.startswith('epub/text/') and rel.endswith('.xhtml') and not re.search(r'(colophon|imprint|uncopyright|titlepage|halftitle|loi|endnotes)',rel):
                    words+=len(re.findall(r"[A-Za-z’']+",text_of(d.decode('utf-8'))))
            # обложка
            png=await render(pg, ep+'/images/cover.svg', 600, 900)
            im=Image.open(io.BytesIO(png)).convert('RGB')
            buf=io.BytesIO(); im.save(buf,'JPEG',quality=78); big=buf.getvalue()
            th=im.resize((240,360),Image.LANCZOS); th.save(f'{OUT}/covers/{slug}.jpg','JPEG',quality=78)
            files['epub/images/cover.svg']=('<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 600 900"><image width="600" height="900" xlink:href="data:image/jpeg;base64,'+base64.b64encode(big).decode()+'"/></svg>').encode()
            # тяжёлые svg-иллюстрации → png
            for rel in [r for r in list(files) if r.startswith('epub/images/') and r.endswith('.svg') and not r.endswith(('cover.svg','logo.svg','titlepage.svg')) and len(files[r])>150000]:
                sv=files[rel].decode('utf-8'); vb=re.search(r'viewBox="([\d.\s-]+)"',sv)
                vw,vh=(float(x) for x in vb.group(1).split()[2:4]) if vb else (1000,1000)
                W=560; H=int(W*vh/vw)
                png=await render(pg, os.path.join(src,rel), W, H)
                im=Image.open(io.BytesIO(png)).convert('L'); o=io.BytesIO(); im.save(o,'JPEG',quality=62,optimize=True)
                newrel=rel[:-4]+'.jpg'; del files[rel]; files[newrel]=o.getvalue()
                base=os.path.basename(rel); nb=base[:-4]+'.jpg'
                for k in list(files):
                    if k.endswith(('.xhtml','.opf','.css')):
                        t=files[k].decode('utf-8')
                        if base in t:
                            t=t.replace(f'images/{base}',f'images/{nb}')
                            if k.endswith('.opf'): t=re.sub(r'(<item href="images/'+re.escape(nb)+r'"[^>]*media-type=")image/svg\+xml',r'\1image/jpeg',t)
                            files[k]=t.encode()
            outp=f'{OUT}/{slug}.epub'
            with zipfile.ZipFile(outp,'w') as z:
                z.writestr(zipfile.ZipInfo('mimetype'),b'application/epub+zip',compress_type=zipfile.ZIP_STORED)
                for rel in sorted(files):
                    if rel=='mimetype': continue
                    z.writestr(rel,files[rel],compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
            sz=os.path.getsize(outp)
            meta.append(dict(id=slug,title=title,author=author,level=lvl,words=words,size=sz,desc=re.sub(r'\s+',' ',text_of(desc)).strip()))
            print(slug,lvl,words,sz//1024,'KB',flush=True)
        await b.close()
    json.dump(meta,open(OUT+'/meta.json','w'),ensure_ascii=False,indent=1)
asyncio.run(main())

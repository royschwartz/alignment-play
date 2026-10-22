// Roy, Oct 11 (257): solid black stepped sides on every activity-held card.
// Each top face keeps its original, unscaled lettering and artwork; side ink
// extends from the cut edges. The real button keeps focus and accessibility.
import { partitionHoldOutline, projectHoldOutline } from './hold-outline.mjs';

const DEPTH = 3;
const EDGE_SAMPLE = 0.25;
const SVG_NS = 'http://www.w3.org/2000/svg';
const smooth = t => { const u = Math.max(0, Math.min(1, t)); return u*u*(3-2*u); };

export function geometry(width, height, className, fill) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', fill); path.setAttribute('stroke', '#000');
  path.setAttribute('stroke-width', '1'); path.setAttribute('stroke-linejoin', 'miter');
  svg.append(path);
  return { svg, path };
}

const rectangle = (x,y,w,h) => `M${x} ${y}h${w}v${h}h-${w}Z`;

export function createActivityHold({ el, button }, { seconds=0.2, tile=24, shade=true, getOutline=null, onSurface=null }={}) {
  let target=null, level=0, from=0, elapsed=0, moving=false;
  let overlay=null, layers=[], copies=[], cells=[], steps=null;
  let width=0, height=0, columns=0, rows=0;
  let shape=null, wallInk=[];

  function clear() {
    overlay?.remove(); overlay=null; layers=[]; copies=[]; cells=[]; steps=null;
    shape=null; wallInk=[];
    el.classList.remove('hold-tiled');
    onSurface?.({ level: 0, faces: null });
  }
  function ink(parent, side=false) {
    const clip=document.createElement('span');
    clip.className='hold-ink';
    clip.style.cssText=`position:absolute;inset:0;z-index:3;width:${width+DEPTH}px;height:${height+DEPTH}px;overflow:hidden;pointer-events:none`;
    const copy=document.createElement('span');
    copy.className='button hold-copy';
    copy.style.cssText=button.style.cssText;
    copy.style.width=`${width}px`; copy.style.height=`${height}px`;
    copy.style.transformOrigin='0 0';
    if(side&&shade)copy.style.color='#fff';
    for(const child of button.childNodes)copy.append(child.cloneNode(true));
    for(const node of copy.querySelectorAll('[id]'))node.removeAttribute('id');
    clip.append(copy); parent.append(clip); copies.push(copy);
    return {clip,copy};
  }
  function mapInk(ink, path, matrix) {
    ink.clip.style.display=path?'':'none';
    if(!path)return;
    ink.clip.style.clipPath=`path('${path}')`;
    ink.copy.style.transform=`matrix(${matrix.join(',')})`;
  }
  function build() {
    if(overlay)return;
    width=button.offsetWidth; height=button.offsetHeight;
    const outline=getOutline?.();
    shape=outline?.length?partitionHoldOutline(width,height,outline,{tile}):null;
    columns=Math.max(1,Math.round((width-1)/tile));
    rows=Math.max(1,Math.round((height-1)/tile));
    const w=(width-1)/columns, h=(height-1)/rows;
    overlay=document.createElement('span'); overlay.className='hold-tiles'; overlay.style.overflow='hidden';
    // The face keeps its original dimensions. Only the overlay extends to
    // include the ordinary 3px depth, including a lowered bar's outer tip.
    if(shape){overlay.style.width=`${width+DEPTH}px`;overlay.style.height=`${height+DEPTH}px`;}
    overlay.setAttribute('aria-hidden','true'); overlay.inert=true;
    for(let parity=0;parity<2;parity++) {
      const group=document.createElement('span'); group.className='hold-checker';
      group.style.width=`${width+DEPTH}px`; group.style.height=`${height+DEPTH}px`;
      group.style.zIndex=parity===0?'3':'1';
      const face=geometry(width+DEPTH,height+DEPTH,'hold-face','#fff');
      group.append(face.svg); overlay.append(group); layers.push({group,face,topInk:ink(group)});
    }
    const sides=document.createElement('span');
    sides.className='hold-side-layer';
    sides.style.cssText='position:absolute;inset:0;z-index:2;pointer-events:none';
    steps=geometry(width+DEPTH,height+DEPTH,'hold-steps',shade?'#000':'#fff');
    sides.append(steps.svg); overlay.append(sides);
    if(shape) {
      wallInk=shape.walls.map(wall=>wall.neighbor===null?null:ink(sides,true));
    } else for(let row=0;row<rows;row++)for(let col=0;col<columns;col++) {
      const parity=(row+col)%2, right=col<columns-1, bottom=row<rows-1;
      cells.push({x:.5+col*w,y:.5+row*h,w,h,row,col,parity,right,bottom,
        rightInk:parity===0&&right?ink(sides,true):null,
        bottomInk:parity===0&&bottom?ink(sides,true):null});
    }
    el.append(overlay); syncArtwork();
  }
  function syncArtwork() {
    const canvases=button.querySelectorAll('canvas'), stains=button.querySelectorAll('.need-stain');
    for(const copy of copies) {
      copy.querySelectorAll('canvas').forEach((canvas,i)=>{
        const source=canvases[i];
        const revision=source.dataset.revision;
        if(revision!=null && canvas.dataset.copiedRevision===revision) return;
        if(canvas.width!==source.width)canvas.width=source.width;
        if(canvas.height!==source.height)canvas.height=source.height;
        const ctx=canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(source,0,0);
        if(revision!=null)canvas.dataset.copiedRevision=revision;
      });
      copy.querySelectorAll('.need-stain').forEach((stain,i)=>{stain.style.opacity=stains[i].style.opacity;});
    }
  }
  function paint() {
    const depth=DEPTH*level;
    if(shape) {
      const frame=projectHoldOutline(shape,level,{depth:DEPTH,edgeSample:EDGE_SAMPLE});
      layers.forEach((layer,i)=>{
        layer.face.path.setAttribute('d',frame.faces[i].path);
        mapInk(layer.topInk,frame.faces[i].path,frame.faces[i].matrix);
      });
      steps.path.setAttribute('d',frame.walls.map(wall=>wall.path).join(''));
      frame.walls.forEach((wall,i)=>{if(wallInk[i])mapInk(wallInk[i],wall.path,wall.matrix);});
      overlay.style.visibility=depth>0?'visible':'hidden';
      el.classList.toggle('hold-tiled',depth>0);
      onSurface?.({ level, faces: frame.faces.map(face => face.path) });
      syncArtwork();
      return;
    }
    // Top UVs never change: raised ink is stationary, lowered ink only moves
    // with its tile. Revealing extra side area must not re-fit the label.
    const faces=['',''];
    let sidePath='';
    for(const c of cells) {
      const {x,y,w,h,parity,right,bottom}=c;
      const z=parity===0?0:depth, other=parity===0?depth:0;
      const top=rectangle(x+z,y+z,w,h);
      faces[parity]+=top;
      const r=x+w, b=y+h;
      const farR=right?other:DEPTH, farB=bottom?other:DEPTH;
      const rightPath=farR>z?`M${r+z} ${y+z}L${r+farR} ${y+farR}L${r+farR} ${b+farR}L${r+z} ${b+z}Z`:'';
      const bottomPath=farB>z?`M${x+z} ${b+z}L${r+z} ${b+z}L${r+farB} ${b+farB}L${x+farB} ${b+farB}Z`:'';
      sidePath+=rightPath+bottomPath;
      // Extrude the ink at the original cut edge onto the connecting side.
      // A subpixel band approximates that edge sample using the same DOM
      // lettering; it never borrows or redistributes ink from the top faces.
      if(c.rightInk) {
        const a=(farR-z)/EDGE_SAMPLE, u=r-EDGE_SAMPLE/2;
        mapInk(c.rightInk,rightPath,[a,a,0,1,r+z-u*a,z-u*a]);
      }
      if(c.bottomInk) {
        const a=(farB-z)/EDGE_SAMPLE, v=b-EDGE_SAMPLE/2;
        mapInk(c.bottomInk,bottomPath,[1,0,a,a,z-v*a,b+z-v*a]);
      }
    }
    layers.forEach((layer,i)=>{
      layer.face.path.setAttribute('d',faces[i]);
      const z=i===0?0:depth;
      mapInk(layer.topInk,faces[i],[1,0,0,1,z,z]);
    });
    steps.path.setAttribute('d',sidePath);
    overlay.style.visibility=depth>0?'visible':'hidden';
    el.classList.toggle('hold-tiled',depth>0);
    onSurface?.({ level, faces });
    syncArtwork();
  }
  return {
    update(held,{dt=0,still=false,covered=false}={}) {
      if(el.classList.contains('taken')||el.classList.contains('fade-out')){clear();return;}
      if(target===null||still||covered||seconds<=0) {
        target=held; level=Number(held); moving=false;
        el.classList.toggle('held',held);
        if(held){build();paint();}else clear();
        return;
      }
      if(held!==target) {
        from=level; target=held; elapsed=0; moving=true;
        el.classList.toggle('held',held); build();
      }
      if(!overlay)return;
      if(moving) {
        elapsed+=Math.max(0,dt); level=from+(Number(target)-from)*smooth(elapsed/seconds);
        if(elapsed>=seconds){moving=false;if(!target){clear();return;}}
      }
      paint();
    },
    destroy:clear,
  };
}

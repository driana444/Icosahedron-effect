import * as T from './three.module.min.js';
import {OrbitControls} from './OrbitControls.js';
const live=[];
export function disposeAll(){while(live.length)live.pop()()}
export async function mount(el,url){
  const r=new T.WebGLRenderer({antialias:true,alpha:true});
  r.setPixelRatio(Math.min(devicePixelRatio||1,2)); r.setClearColor(0,0);
  el.prepend(r.domElement);
  const scene=new T.Scene(),cam=new T.PerspectiveCamera(35,1,.1,50);
  cam.position.set(0,.12,3.3);
  scene.add(new T.HemisphereLight(0xffffff,0x1d6b45,1.15));
  const k=new T.DirectionalLight(0xffffff,2.2);k.position.set(3,4,5);scene.add(k);
  const f=new T.DirectionalLight(0x9dffc4,.9);f.position.set(-4,-1,-3);scene.add(f);
  const buf=await (await fetch(url)).arrayBuffer();
  const [nv,nf]=new Uint32Array(buf,0,2);
  const pos=new Float32Array(buf,8,nv*3), idx=new Uint32Array(buf,8+nv*12,nf*3);
  const g=new T.BufferGeometry();
  g.setAttribute("position",new T.BufferAttribute(pos,3)); g.setIndex(new T.BufferAttribute(idx,1)); g.computeVertexNormals();
  const mesh=new T.Mesh(g,new T.MeshStandardMaterial({color:0xf6f8f4,roughness:.55,metalness:.05}));
  const grp=new T.Group();grp.add(mesh);scene.add(grp);
  g.computeBoundingSphere();const rad=g.boundingSphere.radius,fit=Math.max(1.6,rad*1.08/Math.sin(T.MathUtils.degToRad(17.5)));cam.position.set(0,fit*.04,fit);
  const ctl=new OrbitControls(cam,r.domElement);
  ctl.enableDamping=true;ctl.dampingFactor=.08;ctl.enablePan=true;ctl.screenSpacePanning=true;ctl.zoomSpeed=1.2;ctl.minDistance=fit*.3;ctl.maxDistance=fit*2.2;ctl.rotateSpeed=.9;
  ctl.autoRotate=true;ctl.autoRotateSpeed=1.4;
  let idle;ctl.addEventListener("start",()=>{ctl.autoRotate=false;clearTimeout(idle)});
  ctl.addEventListener("end",()=>{idle=setTimeout(()=>ctl.autoRotate=true,3500)});
  const size=()=>{const w=el.clientWidth,h=el.clientHeight;r.setSize(w,h,false);r.domElement.style.width="100%";r.domElement.style.height="100%";cam.aspect=w/h;cam.updateProjectionMatrix()};
  size();const ro=new ResizeObserver(size);ro.observe(el);
  let raf,vis=true;const io=new IntersectionObserver(e=>{vis=e[0].isIntersecting});io.observe(el);
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const t0=performance.now();
  (function loop(){raf=requestAnimationFrame(loop);if(!vis)return;
    const t=(performance.now()-t0)/1000; grp.position.y=reduce?0:Math.sin(t*1.1)*.07; ctl.update(); r.render(scene,cam)})();
  el.classList.add("ready");
  live.push(()=>{cancelAnimationFrame(raf);ro.disconnect();io.disconnect();ctl.dispose();g.dispose();r.dispose();r.domElement.remove()});
}

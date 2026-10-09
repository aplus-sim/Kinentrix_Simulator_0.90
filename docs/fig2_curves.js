const fs=require('fs'), path=require('path'), B=path.resolve(__dirname, '..');
const CovModel=require(B+'/covmodel.js'), PKSim=require(B+'/pksim.js');
const spec=JSON.parse(fs.readFileSync(B+'/specs/pembrolizumab_fda476.json','utf8'));
const model={structure:spec.structure,Km:null,Vm:null};
const typ=CovModel.build(spec,{WT:77.2,ALB:39.6,IGG:1,SEX:'M'},{});
const OUT=process.argv[2];
const res=[];
for(const [tag,ndose,tend] of [['A',6,126],['B',6,168]]){
  const d={dose:200,tinf:0.5/24,tau:21,ndose,tend};
  const g=PKSim.buildTimeGrid(d), r=PKSim.simulate(model,typ,d,g);
  const n=r.times.length, tail=r.times[n-1]-0.20*(r.times[n-1]-r.times[0]);
  const seg=[]; for(let i=0;i<n;i++) if(r.times[i]>=tail && r.conc[i]>0) seg.push(i);
  const xs=seg.map(i=>r.times[i]), ys=seg.map(i=>Math.log(r.conc[i]));
  const N=xs.length, sx=xs.reduce((a,b)=>a+b,0), sy=ys.reduce((a,b)=>a+b,0);
  const sxx=xs.reduce((a,b)=>a+b*b,0), sxy=xs.reduce((a,b,k)=>a+b*ys[k],0);
  const den=N*sxx-sx*sx, slope=(N*sxy-sx*sy)/den, icpt=(sy-slope*sx)/N;
  fs.writeFileSync(`${OUT}/c_${tag}.csv`,'time,conc\n'+r.times.map((t,i)=>t.toFixed(3)+','+r.conc[i].toFixed(5)).join('\n'));
  res.push({tag,ndose,tend,tail,slope,icpt,thalf:Math.log(2)/(-slope),
            doses:Array.from({length:ndose},(_,k)=>k*21).filter(t=>t<=tend),
            nDoseInWin:Array.from({length:ndose},(_,k)=>k*21).filter(t=>t>=tail&&t<=tend).length});
}
fs.writeFileSync(`${OUT}/c_meta.json`,JSON.stringify({panels:res,analytic:PKSim.terminalHalfLifeAnalytic(typ,spec.structure)},null,1));
console.log(res.map(o=>`${o.tag}: tend=${o.tend} 꼬리${o.tail.toFixed(1)} 주사${o.nDoseInWin}개 → ${o.thalf.toFixed(2)}일`).join('\n'));

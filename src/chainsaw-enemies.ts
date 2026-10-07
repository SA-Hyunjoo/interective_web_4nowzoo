import * as THREE from 'three'

export type SawSweep={start:{x:number;y:number};end:{x:number;y:number};speed:number}
type Fragment={x:number;y:number;z:number;vx:number;vy:number;vz:number;life:number;sx:number;sy:number;sz:number;angle:number;spin:number;color:THREE.Color}
type Drop={x:number;y:number;z:number;vx:number;vy:number;vz:number;life:number;size:number}
type Enemy={group:THREE.Group;arms:THREE.Mesh[];legs:THREE.Mesh[];active:boolean;x:number;y:number;size:number;side:number;targetX:number;speed:number;phase:number;monster:boolean}

export function distanceToSegment(point:{x:number;y:number},start:{x:number;y:number},end:{x:number;y:number}){
  const dx=end.x-start.x,dy=end.y-start.y,lengthSquared=dx*dx+dy*dy
  if(lengthSquared===0)return Math.hypot(point.x-start.x,point.y-start.y)
  const t=Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/lengthSquared))
  return Math.hypot(point.x-(start.x+dx*t),point.y-(start.y+dy*t))
}

export function sweepHitsEnemy(sweep:SawSweep,enemy:{x:number;y:number;size:number}){
  return sweep.speed>=360&&distanceToSegment({x:enemy.x,y:enemy.y+enemy.size*.15},sweep.start,sweep.end)<enemy.size*1.05
}

export function createChainsawEnemies(scene:THREE.Scene){
  const ramp=new THREE.DataTexture(new Uint8Array([48,105,180,255]),4,1,THREE.RedFormat)
  ramp.needsUpdate=true;ramp.minFilter=ramp.magFilter=THREE.NearestFilter;ramp.unpackAlignment=1
  const toon=(color:number)=>new THREE.MeshToonMaterial({color,gradientMap:ramp})
  const skin=toon(0xc98666),monsterSkin=toon(0x6e2930),shirt=toon(0x344858),monsterBody=toon(0x29252e),pants=toon(0x171c23),eye=toon(0xf5e9ba)
  const box=new THREE.BoxGeometry(1,1,1),sphere=new THREE.SphereGeometry(1,12,8),cone=new THREE.ConeGeometry(1,1,5),cylinder=new THREE.CylinderGeometry(1,1,1,8)
  const make=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);return mesh
  }
  const enemies:Enemy[]=Array.from({length:5},(_,index)=>{
    const monster=index%2===0,group=new THREE.Group(),bodyMaterial=monster?monsterBody:shirt,bodySkin=monster?monsterSkin:skin
    group.add(make(box,bodyMaterial,0,0,0,.56,.72,.26))
    group.add(make(cylinder,bodySkin,0,.77,0,.13,.2,.13))
    group.add(make(sphere,bodySkin,0,1.08,0,.34,.38,.31))
    const arms=[make(box,bodySkin,-.72,.05,0,.19,.74,.19),make(box,bodySkin,.72,.05,0,.19,.74,.19)]
    arms[0].rotation.z=-.22;arms[1].rotation.z=.22;group.add(...arms)
    const legs=[make(box,pants,-.27,-1.03,0,.23,.82,.24),make(box,pants,.27,-1.03,0,.23,.82,.24)]
    group.add(...legs)
    if(monster){
      const horns=[make(cone,monsterSkin,-.24,1.5,0,.12,.42,.12),make(cone,monsterSkin,.24,1.5,0,.12,.42,.12)]
      horns[0].rotation.z=-.25;horns[1].rotation.z=.25;group.add(...horns)
      for(const x of [-.13,.13])group.add(make(sphere,eye,x,1.14,.29,.055,.035,.025))
    }else{
      group.add(make(box,pants,0,1.35,-.03,.37,.12,.32))
      for(const x of [-.12,.12])group.add(make(box,eye,x,1.12,.3,.055,.025,.025))
    }
    group.visible=false;scene.add(group)
    return{group,arms,legs,active:false,x:0,y:0,size:70,side:1,targetX:0,speed:60,phase:index,monster}
  })
  const fragmentMesh=new THREE.InstancedMesh(box,new THREE.MeshStandardMaterial({roughness:.68,metalness:.05}),64)
  const bloodMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(1,5,3),new THREE.MeshStandardMaterial({color:0x8e0611,roughness:.42}),144)
  for(const mesh of [fragmentMesh,bloodMesh]){mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;scene.add(mesh)}
  fragmentMesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(fragmentMesh.count*3),3)
  const fragments:Fragment[]=Array.from({length:64},()=>({x:0,y:0,z:0,vx:0,vy:0,vz:0,life:0,sx:1,sy:1,sz:1,angle:0,spin:0,color:new THREE.Color()}))
  const drops:Drop[]=Array.from({length:144},()=>({x:0,y:0,z:0,vx:0,vy:0,vz:0,life:0,size:1}))
  const dummy=new THREE.Object3D();let fragmentCursor=0,dropCursor=0,nextSpawn=0,spawnSerial=0,running=false
  const partOffsets=[[-.72,.05,.2,.74,.2],[.72,.05,.2,.74,.2],[0,.77,.18,.2,.18],[-.27,-1.03,.24,.82,.25],[.27,-1.03,.24,.82,.25],[0,1.08,.36,.38,.32],[0,.2,.56,.38,.27],[0,-.35,.56,.38,.27]]
  function spawnFragment(enemy:Enemy,part:number,cutAngle:number){
    const f=fragments[fragmentCursor++%fragments.length],offset=partOffsets[part]
    const direction=part%2?-1:1,speed=170+Math.random()*330
    f.x=enemy.x+offset[0]*enemy.size;f.y=enemy.y-offset[1]*enemy.size;f.z=45+Math.random()*80
    f.vx=Math.cos(cutAngle+direction*.9)*speed+enemy.side*60;f.vy=-Math.sin(cutAngle+direction*.9)*speed-100-Math.random()*120;f.vz=(Math.random()-.35)*280
    f.life=1.35+Math.random()*.65;f.sx=offset[2]*enemy.size;f.sy=offset[3]*enemy.size;f.sz=offset[4]*enemy.size
    f.angle=Math.random()*Math.PI;f.spin=(Math.random()-.5)*12
    f.color.setHex(part===2||part===5?(enemy.monster?0x6e2930:0xc98666):part>=3&&part<=4?0x171c23:enemy.monster?0x29252e:0x344858)
  }
  function burst(enemy:Enemy,sweep:SawSweep){
    const angle=Math.atan2(sweep.end.y-sweep.start.y,sweep.end.x-sweep.start.x)
    for(let i=0;i<partOffsets.length;i++)spawnFragment(enemy,i,angle)
    for(let i=0;i<42;i++){
      const p=drops[dropCursor++%drops.length],a=Math.random()*Math.PI*2,speed=130+Math.random()*520
      p.x=enemy.x+(Math.random()-.5)*enemy.size;p.y=enemy.y+(Math.random()-.5)*enemy.size*1.5;p.z=70+Math.random()*80
      p.vx=Math.cos(a)*speed;p.vy=Math.sin(a)*speed-110;p.vz=(Math.random()-.4)*300;p.life=.55+Math.random()*.85;p.size=2+Math.random()*5
    }
    enemy.active=false;enemy.group.visible=false;nextSpawn=Math.max(nextSpawn,performance.now()+520)
  }
  function spawn(width:number,height:number,now:number){
    const enemy=enemies.find(value=>!value.active);if(!enemy)return
    const side=spawnSerial++%2===0?-1:1,size=Math.max(48,Math.min(78,height*.105))*(.88+Math.random()*.2)
    enemy.active=true;enemy.group.visible=true;enemy.side=side;enemy.size=size
    enemy.x=side<0?-size*1.5:width+size*1.5;enemy.y=height*(.62+Math.random()*.13)
    enemy.targetX=side<0?width*(.12+Math.random()*.13):width*(.88-Math.random()*.13);enemy.speed=55+Math.random()*38;enemy.phase=Math.random()*Math.PI*2
    enemy.group.scale.setScalar(size);nextSpawn=now+850+Math.random()*650
  }
  function reset(){
    running=false;nextSpawn=0;enemies.forEach(enemy=>{enemy.active=false;enemy.group.visible=false})
    fragments.forEach(value=>{value.life=0});drops.forEach(value=>{value.life=0});fragmentMesh.count=0;bloodMesh.count=0
  }
  function setActive(active:boolean,now:number){
    if(active&&!running){running=true;nextSpawn=now+350}
    else if(!active&&running)reset()
  }
  function update(now:number,dt:number,width:number,height:number,sweeps:SawSweep[],onCut:()=>void){
    if(running&&now>=nextSpawn&&enemies.filter(value=>value.active).length<3)spawn(width,height,now)
    for(const enemy of enemies){
      if(!enemy.active)continue
      const direction=Math.sign(enemy.targetX-enemy.x);enemy.x+=direction*enemy.speed*dt
      if(Math.abs(enemy.targetX-enemy.x)<2)enemy.x=enemy.targetX
      enemy.phase+=dt*3.5;enemy.group.position.set(enemy.x-width/2,height/2-enemy.y+Math.sin(enemy.phase)*5,-35)
      enemy.arms[0].rotation.z=-.22+Math.sin(enemy.phase)*.13;enemy.arms[1].rotation.z=.22-Math.sin(enemy.phase)*.13
      enemy.legs[0].rotation.z=Math.sin(enemy.phase)*.08;enemy.legs[1].rotation.z=-Math.sin(enemy.phase)*.08
      const hit=sweeps.find(sweep=>sweepHitsEnemy(sweep,enemy))
      if(hit){burst(enemy,hit);onCut()}
    }
    let fragmentCount=0
    for(const f of fragments){
      if(f.life<=0)continue
      f.life-=dt;f.x+=f.vx*dt;f.y+=f.vy*dt;f.z+=f.vz*dt;f.vy+=620*dt;f.angle+=f.spin*dt
      dummy.position.set(f.x-width/2,height/2-f.y,f.z);dummy.rotation.set(f.angle*.7,f.angle*.35,f.angle);dummy.scale.set(f.sx,f.sy,f.sz);dummy.updateMatrix()
      fragmentMesh.setMatrixAt(fragmentCount,dummy.matrix);fragmentMesh.setColorAt(fragmentCount,f.color);fragmentCount++
    }
    fragmentMesh.count=fragmentCount;fragmentMesh.instanceMatrix.needsUpdate=true;if(fragmentMesh.instanceColor)fragmentMesh.instanceColor.needsUpdate=true
    let bloodCount=0
    for(const p of drops){
      if(p.life<=0)continue
      p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy+=720*dt
      const fade=Math.max(0,Math.min(1,p.life*4));dummy.position.set(p.x-width/2,height/2-p.y,p.z);dummy.rotation.set(0,0,Math.atan2(-p.vy,p.vx));dummy.scale.set(p.size*2.4*fade,p.size*fade,p.size*.7*fade);dummy.updateMatrix();bloodMesh.setMatrixAt(bloodCount++,dummy.matrix)
    }
    bloodMesh.count=bloodCount;bloodMesh.instanceMatrix.needsUpdate=true
  }
  return{setActive,update,reset,enemies,fragmentMesh,bloodMesh}
}

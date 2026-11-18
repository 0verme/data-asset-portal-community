/**
 * Adapted from fanmihua/data-hub-demo, c00bac8a8405389f8a419d92876664ba9b3e9a6c.
 * Copyright (c) 2026 fanmihua.
 * Copyright (C) 2011 by Ashima Arts (Simplex noise).
 * Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others).
 * MIT license texts are distributed in public/licenses/data-orb.txt.
 */
export const vertexShader = `attribute vec2 p;
void main() {
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const fragmentShader = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uEnergy;
uniform float uPulse;
uniform float uDark;
uniform float uFx;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
// 3D simplex noise derived from Ashima Arts / Stefan Gustavson.
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
void main(){
  float mn=min(uRes.x,uRes.y);
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/mn;
  vec2 p=uv;
  float t=uTime;
  float r=length(p);
  float ang=atan(p.y,p.x);
  float R=.30*(1.+.018*sin(t*1.3)*uFx+.03*uPulse+.018*uEnergy);
  float wob=snoise(vec3(cos(ang)*1.15+t*.13,sin(ang)*1.15-t*.11,t*.32))*(.014+.018*uEnergy+.045*uPulse)*uFx;
  float Rw=R*(1.+wob);
  float d=r-Rw;
  float aa=1.6/mn;
  float inside=1.-smoothstep(-aa,aa,d);
  vec3 col=vec3(0.);
  if(r<Rw+aa*3.){
    float k=clamp(r/Rw,0.,1.);
    vec3 n=vec3(p/Rw,sqrt(max(0.,1.-k*k)));
    float sp=.22+.2*uEnergy+.42*uPulse;
    vec3 q=n*.8;
    float f1=snoise(q+vec3(t*sp*.34,-t*sp*.22,t*sp*.16));
    float f2=snoise(q*1.3+vec3(-t*sp*.26,t*sp*.3,3.7)+f1*.8);
    float f3=snoise(q*1.9+vec3(t*sp*.18,7.1,-t*sp*.24)+f2*.6);
    col=uC1;
    col=mix(col,uC2,smoothstep(-.25,.75,f1)*.72);
    col=mix(col,uC3,smoothstep(.05,.8,f2)*.62);
    col=mix(col,uC4,smoothstep(.3,.95,f3*.6+f1*.35+(.2-n.y)*.25)*.5);
    float silk=sin((f2*2.2+f1*1.4+n.y*1.6)*3.1416);
    col+=vec3(.06)*smoothstep(.55,1.,silk)*(1.-uDark*.4);
    vec3 L=normalize(vec3(-.35,.5,.85));
    float diff=clamp(dot(n,L),0.,1.);
    float fres=pow(1.-n.z,2.3);
    vec3 H=normalize(L+vec3(0.,0.,1.));
    float spec=pow(clamp(dot(n,H),0.,1.),48.);
    col*=.74+.36*diff;
    col=mix(col,vec3(1.),(1.-uDark)*(.1+.3*pow(diff,4.)));
    col+=fres*mix(uC3,vec3(1.),.4)*(.45+.45*uEnergy);
    col+=spec*(.4+.2*uEnergy);
    col+=uC1*(1.-k)*.1*(1.+uEnergy);
  }
  float dd=max(d,0.);
  float halo=exp(-dd*mix(15.,9.,uEnergy))*(.26+.34*uEnergy+.22*uPulse);
  float rim=exp(-abs(d)*110.)*.22*(1.+uEnergy);
  vec3 hc=mix(uC1,uC3,.5+.5*sin(ang+t*.4*uFx));
  hc=mix(hc,uC2,.3);
  float ha=clamp((halo+rim)*mix(.8,1.15,uDark),0.,1.);
  float a=inside+(1.-inside)*ha;
  vec3 c=col*inside+(1.-inside)*hc*ha;
  gl_FragColor=vec4(c,a);
}`;

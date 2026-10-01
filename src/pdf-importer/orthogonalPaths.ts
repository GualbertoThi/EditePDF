import type { PdfShape } from './extractPage.ts'

/** Split packed, compound ruled paths after the page transform. A rotated
 * page can still contain horizontal/vertical rules in viewport coordinates. */
export function orthogonalShapes(path: ArrayLike<number>, matrix: number[], fill: string | null, stroke: string | null, lineWidth: number): PdfShape[] | null {
  const contours: number[][][] = []
  let points: number[][] = []
  for (let i=0;i<path.length;) {
    const command=path[i++]
    if (command===0 || command===1) {
      const x=path[i++],y=path[i++]
      if(command===0){points=[];contours.push(points)}
      points.push([matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]])
    } else if(command===4 && points.length) points.push(points[0])
    else return null
  }
  const result: PdfShape[]=[]
  for(const points of contours){
    if(points.length<2)continue
    if(points.slice(1).some((p,i)=>Math.abs(p[0]-points[i][0])>.02 && Math.abs(p[1]-points[i][1])>.02))return null
    const x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1]))
    const width=Math.max(...points.map(p=>p[0]))-x,height=Math.max(...points.map(p=>p[1]))-y
    if(fill){
      if(points.some(p=>Math.min(Math.abs(p[0]-x),Math.abs(p[0]-x-width))>.02 || Math.min(Math.abs(p[1]-y),Math.abs(p[1]-y-height))>.02))return null
      result.push({x,y,width,height,fill,stroke:null,lineWidth,rounded:false})
    }
    if(stroke)for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i]
      result.push({x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),width:Math.abs(b[0]-a[0]),height:Math.abs(b[1]-a[1]),fill:null,stroke,lineWidth,rounded:false})
    }
  }
  return result.length ? result : null
}

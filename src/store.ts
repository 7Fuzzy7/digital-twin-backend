export class RingBuffer<T>{private buffer:T[]=[];constructor(private maxSize:number){}push(item:T){if(this.buffer.length>=this.maxSize)this.buffer.shift();this.buffer.push(item);}getAll(){return[...this.buffer]}tail(n:number){const a=this.getAll();return a.slice(-n);}}
export const events=new RingBuffer<any>(1000);

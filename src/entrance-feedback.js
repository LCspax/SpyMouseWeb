// Presentation timing is a web tuning, pending reliable emulator input.
export const ENTRANCE_POP_SECONDS=.32;
export function entranceScale(elapsed){
 if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=ENTRANCE_POP_SECONDS)return 1;
 return 1+.22*Math.sin(Math.PI*elapsed/ENTRANCE_POP_SECONDS);
}

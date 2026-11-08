// Ejecutar offline: node experiments/medir-todo.mjs. Cada módulo también es ejecutable.
const folders=['a-captura','b-energia','c-velocidad','d-pitch','e-motor','f-sonido','g-retro'];
let failures=0;
for(const folder of folders){try{await import(`./${folder}/medir.mjs`);}catch(e){failures++;console.error(folder,e.stack);}}
if(failures)process.exitCode=1;

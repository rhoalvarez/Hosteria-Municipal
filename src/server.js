require('dotenv').config();
const app=require('./app'); const {pool}=require('./config/db');
const port=Number(process.env.PORT||3000);
async function start(){
 if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres. Configurá el archivo .env.');
 const conn=await pool.getConnection(); await conn.ping(); conn.release();
 app.listen(port,()=>console.log(`Hostería API escuchando en http://localhost:${port} | Swagger: http://localhost:${port}/api-docs`));
}
start().catch(err=>{console.error('No se pudo iniciar el backend:',err.message);process.exit(1);});
process.on('SIGINT',async()=>{await pool.end();process.exit(0);});

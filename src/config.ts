import 'dotenv/config';
export const config={port:Number(process.env.PORT??3000),corsOrigin:process.env.CORS_ORIGIN??'*',wsPath:process.env.WS_PATH??'/ws'};

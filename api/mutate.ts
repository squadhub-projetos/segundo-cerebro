import { handleMutate } from '../server/monday/handler.js'

// Função serverless (Vercel) de escrita. Usa o mesmo MONDAY_API_TOKEN; MONDAY_WRITE_ENABLED=0 desliga a escrita.
export default handleMutate

import { handleStructure } from '../server/monday/handler.js'

// Função serverless (Vercel) das alterações de schema (tipos e conexões). Protegida por MONDAY_STRUCTURE_ENABLED e SCHEMA_ADMIN_KEY.
export default handleStructure

// ============================================================
// server.js — Backend Lingerie Esquenta
// Deploy: Railway  |  Node.js + Express + PostgreSQL
// ============================================================

const express  = require('express');
const { Pool } = require('pg');
const path     = require('path');
const cors     = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));     // fotos em base64 são grandes
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve os arquivos estáticos (index.html, admin.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// ── Conexão com o banco (Railway injeta DATABASE_URL) ────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// ── Cria a tabela na primeira execução ───────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS produtos (
      id            SERIAL PRIMARY KEY,
      nome          TEXT    NOT NULL,
      descricao     TEXT,
      preco         TEXT    NOT NULL,
      preco_original TEXT,
      desconto      TEXT,
      fotos         TEXT[], -- array de strings base64 ou URLs
      ativo         BOOLEAN DEFAULT TRUE,
      criado_em     TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ Tabela "produtos" pronta.');
}

// ════════════════════════════════════════════════════════════
// ROTAS DA API
// ════════════════════════════════════════════════════════════

// GET /api/produtos — lista todos os ativos (usado pelo site)
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM produtos WHERE ativo = TRUE ORDER BY id ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/produtos:', err);
    res.status(500).json({ erro: 'Erro ao buscar produtos.' });
  }
});

// GET /api/admin/produtos — lista TODOS (inclusive inativos) para o admin
app.get('/api/admin/produtos', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM produtos ORDER BY id ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar produtos.' });
  }
});

// POST /api/admin/produtos — cria novo produto
app.post('/api/admin/produtos', adminAuth, async (req, res) => {
  const { nome, descricao, preco, preco_original, desconto, fotos } = req.body;
  if (!nome || !preco) {
    return res.status(400).json({ erro: 'nome e preco são obrigatórios.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nome, descricao || '', preco, preco_original || null, desconto || null, fotos || []]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/admin/produtos:', err);
    res.status(500).json({ erro: 'Erro ao criar produto.' });
  }
});

// PUT /api/admin/produtos/:id — edita produto existente
app.put('/api/admin/produtos/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, preco, preco_original, desconto, fotos, ativo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE produtos SET
         nome          = COALESCE($1, nome),
         descricao     = COALESCE($2, descricao),
         preco         = COALESCE($3, preco),
         preco_original= $4,
         desconto      = $5,
         fotos         = COALESCE($6, fotos),
         ativo         = COALESCE($7, ativo),
         atualizado_em = NOW()
       WHERE id = $8 RETURNING *`,
      [nome, descricao, preco, preco_original, desconto, fotos, ativo, id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /api/admin/produtos/:id:', err);
    res.status(500).json({ erro: 'Erro ao atualizar produto.' });
  }
});

// DELETE /api/admin/produtos/:id — desativa (soft delete)
app.delete('/api/admin/produtos/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE produtos SET ativo = FALSE WHERE id = $1', [id]);
    res.json({ sucesso: true, mensagem: 'Produto desativado.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao desativar produto.' });
  }
});

// DELETE real (permanente) — cuidado!
app.delete('/api/admin/produtos/:id/permanente', adminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM produtos WHERE id = $1', [id]);
    res.json({ sucesso: true, mensagem: 'Produto excluído permanentemente.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao excluir produto.' });
  }
});

// POST /api/admin/importar — importa lista de produtos de uma vez (JSON array)
app.post('/api/admin/importar', adminAuth, async (req, res) => {
  const lista = req.body; // array de produtos
  if (!Array.isArray(lista)) {
    return res.status(400).json({ erro: 'Envie um array de produtos.' });
  }
  let importados = 0;
  for (const p of lista) {
    if (!p.nome || !p.preco) continue;
    await pool.query(
      `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [p.nome, p.descricao || '', p.preco, p.preco_original || null, p.desconto || null, p.fotos || []]
    );
    importados++;
  }
  res.json({ sucesso: true, importados });
});

// ── Rota de saúde ────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'conectado', timestamp: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'erro', db: 'desconectado' });
  }
});

// ── Fallback: serve index.html para qualquer rota não-API ────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ════════════════════════════════════════════════════════════
// MIDDLEWARE DE AUTENTICAÇÃO ADMIN
// (senha simples via header — suficiente pra loja pequena)
// ════════════════════════════════════════════════════════════
function adminAuth(req, res, next) {
  const senha = req.headers['x-admin-senha'] || req.query.senha;
  const SENHA = process.env.ADMIN_SENHA || 'esquenta2026';
  if (senha !== SENHA) {
    return res.status(401).json({ erro: 'Não autorizado. Senha inválida.' });
  }
  next();
}

// ── Start ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch(err => {
  console.error('❌ Falha ao inicializar banco:', err);
  process.exit(1);
});

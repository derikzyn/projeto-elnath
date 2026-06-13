// ============================================================
// server.js — Versão com Trava de Segurança
// ============================================================

const express  = require('express');
const { Pool } = require('pg');
const path     = require('path');
const cors     = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trava de segurança para o banco de dados
if (!process.env.DATABASE_URL) {
  console.error("❌ ERRO CRÍTICO: DATABASE_URL não está configurada no Railway!");
  process.exit(1);
}

console.log("✅ DATABASE_URL encontrada. Iniciando conexão...");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Inicialização do Banco
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT,
      preco TEXT NOT NULL,
      preco_original TEXT,
      desconto TEXT,
      fotos TEXT[],
      ativo BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ Tabela "produtos" pronta.');
}

// Rotas
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM produtos WHERE ativo = TRUE ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/produtos:', err);
    res.status(500).json({ erro: 'Erro ao buscar produtos.' });
  }
});

app.get('/api/admin/produtos', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar produtos.' });
  }
});

app.post('/api/admin/produtos', adminAuth, async (req, res) => {
  const { nome, descricao, preco, preco_original, desconto, fotos } = req.body;
  if (!nome || !preco) return res.status(400).json({ erro: 'nome e preco são obrigatórios.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nome, descricao || '', preco, preco_original || null, desconto || null, fotos || []]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST:', err);
    res.status(500).json({ erro: 'Erro ao criar produto.' });
  }
});

app.put('/api/admin/produtos/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, preco, preco_original, desconto, fotos, ativo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE produtos SET nome = COALESCE($1, nome), descricao = COALESCE($2, descricao), preco = COALESCE($3, preco), preco_original = $4, desconto = $5, fotos = COALESCE($6, fotos), ativo = COALESCE($7, ativo), atualizado_em = NOW() WHERE id = $8 RETURNING *`,
      [nome, descricao, preco, preco_original, desconto, fotos, ativo, id]
    );
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar.' });
  }
});

app.delete('/api/admin/produtos/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('UPDATE produtos SET ativo = FALSE WHERE id = $1', [req.params.id]);
    res.json({ sucesso: true });
  } catch (err) { res.status(500).json({ erro: 'Erro' }); }
});

// Middleware de Autenticação
function adminAuth(req, res, next) {
  const senha = req.headers['x-admin-senha'] || req.query.senha;
  if (senha !== (process.env.ADMIN_SENHA || 'esquenta2026')) return res.status(401).json({ erro: 'Não autorizado.' });
  next();
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
}).catch(err => {
  console.error('❌ Falha ao inicializar:', err);
  process.exit(1);
});

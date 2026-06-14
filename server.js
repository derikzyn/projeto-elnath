const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Conexão com o banco ──────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ── Cria a tabela ───────────────────────────────────────────
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

// ── Auth ────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const senha = req.headers['x-admin-senha'] || req.query.senha;
  const SENHA = process.env.ADMIN_SENHA || 'esquenta2026';
  if (senha !== SENHA) return res.status(401).json({ erro: 'Não autorizado.' });
  next();
}

// ============================================================
// ROTAS NOVAS (As que faltaram e causaram o erro)
// ============================================================

// Rota de Health Check (para o painel mostrar "Conectado")
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ db: 'conectado', status: 'ok' });
  } catch (err) {
    res.status(500).json({ db: 'erro', status: 'offline' });
  }
});

// Rota de Importação (para o botão Importar JSON funcionar)
app.post('/api/admin/importar', adminAuth, async (req, res) => {
  const produtos = req.body;
  if (!Array.isArray(produtos)) return res.status(400).json({ erro: 'Formato inválido. Array esperado.' });

  let importados = 0;
  try {
    for (const p of produtos) {
      if (!p.nome || !p.preco) continue; // Pula se faltar dados obrigatórios
      await pool.query(
        `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [p.nome, p.descricao || '', p.preco, p.preco_original || null, p.desconto || null, p.fotos || []]
      );
      importados++;
    }
    res.json({ sucesso: true, importados });
  } catch (err) {
    console.error('Erro na importação:', err);
    res.status(500).json({ erro: 'Erro ao importar produtos.' });
  }
});

// ============================================================
// RESTANTE DAS ROTAS CRUD
// ============================================================

app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM produtos WHERE ativo = TRUE ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
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
      `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nome, descricao || '', preco, preco_original || null, desconto || null, fotos || []]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
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

// ── Start ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
}).catch(err => {
  console.error('❌ Falha ao inicializar:', err);
  process.exit(1);
});

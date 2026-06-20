const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// ── Middleware de Segurança e Performance ────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// ── Conexão com o Banco de Dados ─────────────────────────────
let pool;

try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('❌ Erro inesperado no pool de conexões:', err.message);
  });
} catch (err) {
  console.error('❌ Erro crítico ao inicializar Pool do Postgres:', err.message);
}

// ── Inicialização do Banco (Blindada contra tabelas antigas) ──
async function initDB() {
  try {
    // 1. Garante que a estrutura base da tabela existe
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

    // 2. FORÇA A INJEÇÃO DA COLUNA CATEGORIA (Evita o erro 500 em tabelas antigas)
    await pool.query(`
      ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) DEFAULT 'Geral';
    `);

    console.log('✅ Tabela "produtos" e coluna "categoria" prontas e verificadas.');
    return true;
  } catch (err) {
    console.error('❌ Erro ao inicializar ou atualizar o banco de dados:', err.message);
    return false;
  }
}

// ── Autenticação do Painel Admin ─────────────────────────────
function adminAuth(req, res, next) {
  const senha = req.headers['x-admin-senha'] || req.query.senha || req.body.senha;
  const SENHA_MESTRA = process.env.ADMIN_SENHA || 'esquenta2026';
  
  if (!senha || senha !== SENHA_MESTRA) {
    return res.status(401).json({ erro: 'Não autorizado. Senha incorreta ou ausente.' });
  }
  next();
}

// ============================================================
// ROTAS DE VERIFICAÇÃO DE SAÚDE (HEALTHCHECKS)
// ============================================================

app.get('/', (req, res) => {
  res.status(200).send('API Lingerie Esquenta Online ✔️');
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', database: 'connected', uptime: process.uptime() });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ============================================================
// ROTAS PÚBLICAS (CONSUMIDAS PELO SITE / FRONTEND)
// ============================================================

app.get('/api/produtos', async (req, res) => {
  try {
    const { categoria, limite, pagina } = req.query;
    const parsedLimit = Math.min(parseInt(limite) || 40, 100); 
    const offset = ((parseInt(pagina) || 1) - 1) * parsedLimit;

    let query = 'SELECT id, nome, descricao, preco, preco_original, desconto, fotos, categoria FROM produtos WHERE ativo = TRUE';
    const params = [];

    if (categoria) {
      params.push(categoria);
      query += ` AND categoria = $${params.length}`;
    }

    params.push(parsedLimit, offset);
    query += ` ORDER BY id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar produtos:', err.message);
    res.status(500).json({ erro: 'Erro interno ao processar a lista de produtos.' });
  }
});

app.get('/api/categorias', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT categoria FROM produtos WHERE ativo = TRUE AND categoria IS NOT NULL ORDER BY categoria ASC'
    );
    res.json(rows.map(r => r.categoria));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar categorias dinâmicas.' });
  }
});

// ============================================================
// ROTAS PRIVADAS DO PAINEL ADMINISTRATIVO
// ============================================================

app.get('/api/admin/produtos', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, descricao, preco, preco_original, desconto, fotos, categoria, ativo FROM produtos ORDER BY id DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar dados do painel.' });
  }
});

app.post('/api/admin/produtos', adminAuth, async (req, res) => {
  const { nome, descricao, preco, preco_original, desconto, fotos, categoria } = req.body;
  if (!nome || !preco) return res.status(400).json({ erro: 'Nome e Preço são campos obrigatórios.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos, categoria)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [nome, descricao || '', preco, preco_original || null, desconto || null, fotos || [], categoria || 'Geral']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao cadastrar o produto no banco.' });
  }
});

app.put('/api/admin/produtos/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, preco, preco_original, desconto, fotos, ativo, categoria } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE produtos 
       SET nome = COALESCE($1, nome), 
           descricao = COALESCE($2, descricao), 
           preco = COALESCE($3, preco), 
           preco_original = $4, 
           desconto = $5, 
           fotos = COALESCE($6, fotos), 
           categoria = COALESCE($7, categoria),
           ativo = COALESCE($8, ativo), 
           atualizado_em = NOW() 
       WHERE id = $9 
       RETURNING *`,
      [nome, descricao, preco, preco_original, desconto, fotos, categoria, ativo, id]
    );

    if (rows.length === 0) return res.status(404).json({ erro: 'Produto não localizado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar dados do produto.' });
  }
});

app.post('/api/admin/importar', adminAuth, async (req, res) => {
  const produtos = req.body;
  if (!Array.isArray(produtos)) return res.status(400).json({ erro: 'Formato de dados inválido. Esperado um Array.' });

  let inseridos = 0;
  try {
    for (const p of produtos) {
      if (!p.nome || !p.preco) continue;
      await pool.query(
        `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos, categoria)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.nome, p.descricao || '', p.preco, p.preco_original || null, p.desconto || null, p.fotos || [], p.categoria || 'Geral']
      );
      inseridos++;
    }
    res.json({ sucesso: true, quantidade: inseridos });
  } catch (err) {
    res.status(500).json({ erro: 'Falha durante a importação em lote.' });
  }
});

app.delete('/api/admin/produtos/:id', adminAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query('UPDATE produtos SET ativo = FALSE WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json({ sucesso: true, mensagem: 'Produto desativado com sucesso.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao ocultar produto.' });
  }
});

// ── Ativação do Servidor ─────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor escutando na porta ${PORT} em modo estável.`);
  initDB();
});

// Trata erros inesperados globalmente para evitar quedas por bobeira
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Rejeição não tratada detectada:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Exceção não capturada detectada:', err.message);
});

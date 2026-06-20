const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

// ── Conexão com o banco (Blindada contra quedas) ─────────────
let pool;

try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    console.error('❌ Erro no pool de conexão:', err);
  });
} catch (err) {
  console.error('❌ Erro ao criar pool:', err);
}

// ── Cria a tabela com a coluna Categoria ─────────────────────
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        descricao TEXT,
        preco TEXT NOT NULL,
        preco_original TEXT,
        desconto TEXT,
        fotos TEXT[],
        categoria VARCHAR(50) DEFAULT 'Geral',
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP DEFAULT NOW(),
        atualizado_em TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Tabela "produtos" pronta e atualizada.');
    return true;
  } catch (err) {
    console.error('⚠️ Banco demorando a responder, mas o servidor segue online:', err.message);
    return false;
  }
}

// ── Auth Admin ───────────────────────────────────────────────
function adminAuth(req, res, next) {
  const senha = req.headers['x-admin-senha'] || req.query.senha || req.body.senha;
  const SENHA = process.env.ADMIN_SENHA || 'esquenta2026';
  if (senha !== SENHA) return res.status(401).json({ erro: 'Não autorizado.' });
  next();
}

// ============================================================
// ROTAS ESTÁTICAS E HEALTH CHECK
// ============================================================

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ db: 'conectado', status: 'ok', timestamp: new Date() });
  } catch (err) {
    res.status(500).json({ db: 'erro', status: 'offline', erro: err.message });
  }
});

// ============================================================
// ROTAS PÚBLICAS (O SITE)
// ============================================================

// Buscar todos os produtos (com filtro opcional por categoria)
app.get('/api/produtos', async (req, res) => {
  try {
    const categoria = req.query.categoria;
    let query = 'SELECT * FROM produtos WHERE ativo = TRUE';
    const params = [];

    if (categoria) {
      query += ' AND categoria = $1';
      params.push(categoria);
    }
    
    query += ' ORDER BY id ASC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar produtos.' });
  }
});

// Listar as categorias existentes dinamicamente
app.get('/api/categorias', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT categoria FROM produtos WHERE ativo = TRUE ORDER BY categoria ASC`
    );
    res.json(rows.map(r => r.categoria));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar categorias.' });
  }
});

// ============================================================
// ROTAS DO PAINEL ADMIN
// ============================================================

// Importar JSON em massa
app.post('/api/admin/importar', adminAuth, async (req, res) => {
  const produtos = req.body;
  if (!Array.isArray(produtos)) return res.status(400).json({ erro: 'Formato inválido. Array esperado.' });

  let importados = 0;
  try {
    for (const p of produtos) {
      if (!p.nome || !p.preco) continue;
      
      const categoria = p.categoria || 'Geral';
      
      await pool.query(
        `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos, categoria)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.nome, p.descricao || '', p.preco, p.preco_original || null, p.desconto || null, p.fotos || [], categoria]
      );
      importados++;
    }
    res.json({ sucesso: true, importados });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao importar produtos.' });
  }
});

// Buscar todos os produtos (incluindo inativos para o painel)
app.get('/api/admin/produtos', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar produtos.' });
  }
});

// Criar produto novo
app.post('/api/admin/produtos', adminAuth, async (req, res) => {
  const { nome, descricao, preco, preco_original, desconto, fotos, categoria } = req.body;
  if (!nome || !preco) return res.status(400).json({ erro: 'Nome e preço são obrigatórios.' });
  
  try {
    const { rows } = await pool.query(
      `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos, categoria)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [nome, descricao || '', preco, preco_original || null, desconto || null, fotos || [], categoria || 'Geral']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar produto.' });
  }
});

// Atualizar produto existente
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
    
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar.' });
  }
});

// Deletar produto (Soft Delete: apenas desativa)
app.delete('/api/admin/produtos/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('UPDATE produtos SET ativo = FALSE WHERE id = $1', [req.params.id]);
    res.json({ sucesso: true, mensagem: 'Produto desativado com sucesso.' });
  } catch (err) { 
    res.status(500).json({ erro: 'Erro ao deletar' }); 
  }
});

// ── Start do Servidor sem travar ─────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  initDB(); // Roda a checagem do banco em segundo plano
});

// Tratamento global para impedir que o servidor caia por bobeira
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Aviso (Ignorado para não cair):', err.message);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Exceção (Ignorado para não cair):', err.message);
});

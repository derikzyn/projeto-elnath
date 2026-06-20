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

// ── Conexão com o banco ──────────────────────────────────────
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
  process.exit(1);
}

// ── Cria a tabela ───────────────────────────────────────────
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
    console.log('✅ Tabela "produtos" pronta.');
    return true;
  } catch (err) {
    console.error('❌ Erro ao criar tabela:', err.message);
    return false;
  }
}

// ── Auth ────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const senha = req.headers['x-admin-senha'] || req.query.senha || req.body.senha;
  const SENHA = process.env.ADMIN_SENHA || 'esquenta2026';
  if (senha !== SENHA) return res.status(401).json({ erro: 'Não autorizado.' });
  next();
}

// ============================================================
// ROTAS ESTÁTICAS (SERVE FILES)
// ============================================================

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================================
// ROTAS DE HEALTH CHECK E CONFIGURAÇÃO
// ============================================================

// Rota de Health Check
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1');
    res.json({ db: 'conectado', status: 'ok', timestamp: new Date() });
  } catch (err) {
    console.error('Health check erro:', err.message);
    res.status(500).json({ db: 'erro', status: 'offline', erro: err.message });
  }
});

// Rota de Importação de JSON
app.post('/api/admin/importar', adminAuth, async (req, res) => {
  const produtos = req.body;
  if (!Array.isArray(produtos)) return res.status(400).json({ erro: 'Formato inválido. Array esperado.' });

  let importados = 0;
  let erros = [];

  try {
    for (const p of produtos) {
      if (!p.nome || !p.preco) {
        erros.push(`Produto ignorado: faltam dados obrigatórios`);
        continue;
      }
      
      const categoria = p.categoria || 'Geral';
      
      try {
        await pool.query(
          `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos, categoria)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [p.nome, p.descricao || '', p.preco, p.preco_original || null, p.desconto || null, p.fotos || [], categoria]
        );
        importados++;
      } catch (insertErr) {
        erros.push(`Erro ao inserir ${p.nome}: ${insertErr.message}`);
      }
    }
    
    res.json({ 
      sucesso: true, 
      importados,
      erros: erros.length > 0 ? erros : undefined
    });
  } catch (err) {
    console.error('Erro na importação:', err);
    res.status(500).json({ erro: 'Erro ao importar produtos.' });
  }
});

// ============================================================
// ROTAS CRUD PÚBLICAS
// ============================================================

// Listar todos os produtos ativos (públicos)
app.get('/api/produtos', async (req, res) => {
  try {
    const categoria = req.query.categoria;
    let query = 'SELECT * FROM produtos WHERE ativo = TRUE';
    const params = [];

    if (categoria) {
      query += ' AND categoria = $1';
      params.push(categoria);
      query += ' ORDER BY id ASC';
    } else {
      query += ' ORDER BY id ASC';
    }

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ erro: 'Erro ao buscar produtos.' });
  }
});

// Listar categorias disponíveis
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
// ROTAS ADMIN (PROTEGIDAS)
// ============================================================

// Listar todos os produtos (admin)
app.get('/api/admin/produtos', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar produtos.' });
  }
});

// Criar produto
app.post('/api/admin/produtos', adminAuth, async (req, res) => {
  const { nome, descricao, preco, preco_original, desconto, fotos, categoria } = req.body;
  if (!nome || !preco) return res.status(400).json({ erro: 'nome e preco são obrigatórios.' });
  
  try {
    const { rows } = await pool.query(
      `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos, categoria)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [nome, descricao || '', preco, preco_original || null, desconto || null, fotos || [], categoria || 'Geral']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ erro: 'Erro ao criar produto.' });
  }
});

// Atualizar produto
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
    console.error('Erro:', err);
    res.status(500).json({ erro: 'Erro ao atualizar.' });
  }
});

// Deletar produto (soft delete)
app.delete('/api/admin/produtos/:id', adminAuth, async (req, res) => {
  try {
    const result = await pool.query('UPDATE produtos SET ativo = FALSE WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ erro: 'Produto não encontrado.' });
    }
    res.json({ sucesso: true, mensagem: 'Produto desativado com sucesso.' });
  } catch (err) { 
    res.status(500).json({ erro: 'Erro ao deletar' }); 
  }
});

// ── Start ────────────────────────────────────────────────────
async function start() {
  try {
    const dbReady = await initDB();
    if (!dbReady) {
      console.warn('⚠️ Banco não estava pronto, mas continuando...');
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
      console.log(`📍 http://localhost:${PORT}/index.html`);
      console.log(`📍 http://localhost:${PORT}/admin.html`);
    });
  } catch (err) {
    console.error('❌ Erro ao iniciar:', err);
    setTimeout(start, 5000); // Tenta reconectar em 5s
  }
}

// Tratamento de erros não capturados
process.on('unhandledRejection', (err) => {
  console.error('❌ Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Exceção não capturada:', err);
  setTimeout(() => process.exit(1), 1000);
});

start();

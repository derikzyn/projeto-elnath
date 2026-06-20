const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// ── Middlewares de Payload e Segurança ───────────────────────────
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(__dirname));

// ── Conexão Otimizada com o Banco (Evita estouro de RAM no Pool) ──
let pool;

try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 4, // Restringe conexões simultâneas para poupar recursos no plano free
    idleTimeoutMillis: 8000, // Encerra conexões inativas imediatamente
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('❌ Erro detectado no pool do Postgres:', err.message);
  });
} catch (err) {
  console.error('❌ Erro crítico na configuração do Postgres:', err.message);
}

// ── Sincronização e Atualização Estrutural do Banco ──────────────
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
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP DEFAULT NOW(),
        atualizado_em TIMESTAMP DEFAULT NOW()
      );
    `);

    // Injeta a coluna de categoria caso o banco venha de uma versão pré-existente
    await pool.query(`
      ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) DEFAULT 'Geral';
    `);

    console.log('✅ Banco de dados atualizado e estruturado.');
    return true;
  } catch (err) {
    console.error('⚠️ Sincronização pendente. Reconectando em segundo plano...', err.message);
    return false;
  }
}

// ── Validação de Segurança Admin ─────────────────────────────────
function adminAuth(req, res, next) {
  const senha = req.headers['x-admin-senha'] || req.query.senha || req.body.senha;
  const SENHA_MESTRA = process.env.ADMIN_SENHA || 'esquenta2026';
  
  if (!senha || senha !== SENHA_MESTRA) {
    return res.status(401).json({ erro: 'Acesso não autorizado.' });
  }
  next();
}

// ============================================================
// VERIFICAÇÃO DE STATUS E ROTAS ESTÁTICAS
// ============================================================

app.get('/', (req, res) => {
  res.status(200).send('API Lingerie Esquenta - Operando Normalmente');
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ============================================================
// ROTAS PÚBLICAS DA VITRINE
// ============================================================

app.get('/api/produtos', async (req, res) => {
  try {
    const { categoria } = req.query;
    let query = 'SELECT id, nome, descricao, preco, preco_original, desconto, fotos, categoria FROM produtos WHERE ativo = TRUE';
    const params = [];

    if (categoria) {
      params.push(categoria);
      query += ` AND categoria = $1`;
    }

    query += ' ORDER BY id ASC LIMIT 50';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar vitrine.' });
  }
});

app.get('/api/categorias', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT categoria FROM produtos WHERE ativo = TRUE AND categoria IS NOT NULL ORDER BY categoria ASC'
    );
    res.json(rows.map(r => r.categoria));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao coletar tags de categorias.' });
  }
});

// ============================================================
// PAINEL DE CONTROLE (ADMIN REQUISICOES UNITARIAS)
// ============================================================

app.get('/api/admin/produtos', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, descricao, preco, preco_original, desconto, fotos, categoria, ativo FROM produtos ORDER BY id DESC LIMIT 50'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro no carregamento dos dados administrativos.' });
  }
});

app.post('/api/admin/produtos', adminAuth, async (req, res) => {
  const { nome, descricao, preco, preco_original, desconto, fotos, categoria } = req.body;
  if (!nome || !preco) return res.status(400).json({ erro: 'Nome e Preço são mandatórios.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos, categoria)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nome`,
      [nome, descricao || '', preco, preco_original || null, desconto || null, fotos || [], categoria || 'Geral']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao processar inserção no banco.' });
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
       RETURNING id`,
      [nome, descricao, preco, preco_original, desconto, fotos, categoria, ativo, id]
    );

    if (rows.length === 0) return res.status(404).json({ erro: 'Produto ausente.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao processar atualização.' });
  }
});

app.delete('/api/admin/produtos/:id', adminAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query('UPDATE produtos SET ativo = FALSE WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ erro: 'Produto não identificado.' });
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao alterar status de exibição.' });
  }
});

// ── Ativação da Escuta em Rede Externa ───────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor escutando na porta ${PORT} em modo estável.`);
  initDB();
});

// Tratamento global para isolar exceções assíncronas
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Rejeição assíncrona blindada:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Exceção fatal mitigada:', err.message);
});

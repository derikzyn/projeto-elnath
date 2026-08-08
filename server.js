const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Middlewares
// CORREÇÃO 1: CORS explícito para garantir acesso livre da vitrine
app.use(cors({ origin: '*' })); 
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// Pool OTIMIZADO
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 3000,
  connectionTimeoutMillis: 3000,
});

pool.on('error', (err) => console.error('❌ Pool error:', err.message));

// INICIALIZAR BANCO
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
    console.log('✅ Banco OK');
  } catch (err) {
    console.error('⚠️ Erro no banco:', err.message);
  }
}

// AUTH - MELHORADO COM DEBUG
function auth(req, res, next) {
  const senha = (req.headers['x-admin-senha'] || req.query.senha || req.body.senha || '').trim();
  const SENHA_CORRETA = (process.env.ADMIN_SENHA || 'esquenta2026').trim();
  
  if (!senha || senha !== SENHA_CORRETA) {
    return res.status(401).json({ erro: 'Senha incorreta' });
  }
  
  next();
}

// ROTAS PÚBLICAS (Acesso da Vitrine - index.html)
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'erro' });
  }
});

app.get('/api/produtos', async (req, res) => {
  try {
    // CORREÇÃO 2: Adicionado preco_original e desconto. Ordenado por produtos mais recentes.
    const { rows } = await pool.query('SELECT id, nome, descricao, preco, preco_original, desconto, fotos, categoria FROM produtos WHERE ativo=TRUE ORDER BY id DESC');
    res.json(rows);
  } catch (e) {
    console.error('❌ Erro ao listar produtos (público):', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ADMIN - IMPORTAÇÃO
app.post('/api/admin/importar', auth, async (req, res) => {
  const produtos = req.body;
  if (!Array.isArray(produtos)) return res.status(400).json({ erro: 'Array esperado' });

  let ok = 0;
  try {
    for (const p of produtos) {
      if (!p.nome || !p.preco) continue;
      // CORREÇÃO 3: Agora salva os dados de promoção corretamente no banco
      await pool.query(
        'INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, fotos, categoria) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [p.nome, p.descricao || '', p.preco, p.preco_original || null, p.desconto || null, p.fotos || [], p.categoria || 'Geral']
      );
      ok++;
      if (ok % 5 === 0) await new Promise(r => setTimeout(r, 50));
    }
    res.json({ sucesso: true, importados: ok });
  } catch (e) {
    console.error('❌ Erro ao importar produtos:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ADMIN - LISTAR
app.get('/api/admin/produtos', auth, async (req, res) => {
  try {
    // CORREÇÃO 4: Retirado o 'LIMIT 30' para não ocultar produtos do painel e ordenado por mais novo
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
    res.json(rows);
  } catch (e) {
    console.error('❌ Erro ao listar produtos (admin):', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ADMIN - CRIAR
app.post('/api/admin/produtos', auth, async (req, res) => {
  const { nome, descricao, preco, preco_original, desconto, categoria, fotos } = req.body;
  if (!nome || !preco) return res.status(400).json({ erro: 'Nome e preço obrigatórios' });
  
  try {
    const { rows } = await pool.query(
      'INSERT INTO produtos (nome, descricao, preco, preco_original, desconto, categoria, fotos) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nome',
      [nome, descricao || '', preco, preco_original || null, desconto || null, categoria || 'Geral', fotos || []]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('❌ Erro ao criar produto:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ADMIN - DELETAR
app.delete('/api/admin/produtos/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE produtos SET ativo=FALSE WHERE id=$1', [req.params.id]);
    res.json({ sucesso: true });
  } catch (e) {
    console.error('❌ Erro ao deletar produto:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ADMIN - EDITAR (nome, descrição, preço, categoria, fotos — tudo em um só endpoint)
app.put('/api/admin/produtos/:id', auth, async (req, res) => {
  const { nome, descricao, preco, preco_original, desconto, categoria, fotos } = req.body;
  try {
    const atual = await pool.query('SELECT * FROM produtos WHERE id=$1', [req.params.id]);
    if (!atual.rows.length) return res.status(404).json({ erro: 'Produto não encontrado' });
    const p = atual.rows[0];

    const { rows } = await pool.query(
      `UPDATE produtos SET
        nome = $1, descricao = $2, preco = $3, preco_original = $4,
        desconto = $5, categoria = $6, fotos = $7, atualizado_em = NOW()
       WHERE id = $8 RETURNING *`,
      [
        nome ?? p.nome,
        descricao ?? p.descricao,
        preco ?? p.preco,
        preco_original !== undefined ? preco_original : p.preco_original,
        desconto !== undefined ? desconto : p.desconto,
        categoria ?? p.categoria,
        fotos ?? p.fotos,
        req.params.id
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('❌ Erro ao editar produto:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// ADMIN - UPLOAD DE FOTO (converte a imagem em link via ImgBB, evita salvar base64 pesado no banco)
app.post('/api/admin/upload', auth, async (req, res) => {
  const { imagem } = req.body;
  if (!imagem) return res.status(400).json({ erro: 'Nenhuma imagem enviada' });
  if (!process.env.IMGBB_API_KEY) {
    console.error('❌ IMGBB_API_KEY não configurada no ambiente do servidor.');
    return res.status(500).json({ erro: 'Upload de imagem não configurado no servidor (falta IMGBB_API_KEY).' });
  }

  try {
    // Aceita tanto "data:image/png;base64,AAAA..." quanto o base64 puro
    const base64 = imagem.includes(',') ? imagem.split(',')[1] : imagem;

    const params = new URLSearchParams();
    params.append('image', base64);

    const resposta = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
      method: 'POST',
      body: params
    });
    const data = await resposta.json();

    if (!data.success) {
      console.error('❌ ImgBB recusou o upload:', data);
      return res.status(500).json({ erro: data?.error?.message || 'Falha no upload da imagem' });
    }

    res.json({ url: data.data.url });
  } catch (e) {
    console.error('❌ Erro ao enviar imagem para o ImgBB:', e.message);
    res.status(500).json({ erro: e.message });
  }
});

// START
initDB();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor na porta ${PORT}`);
});

process.on('uncaughtException', (err) => console.error('❌ Erro:', err.message));
process.on('unhandledRejection', (err) => console.error('❌ Rejeição:', err.message));

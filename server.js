const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // Faz o seu site principal (index.html) continuar funcionando

// Conecta no Banco de Dados do Railway
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Cria a tabela automaticamente quando o servidor liga
pool.query(`
    CREATE TABLE IF NOT EXISTS produtos (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(255),
        preco VARCHAR(50)
    );
    -- Insere um produto de teste para você ver funcionando
    INSERT INTO produtos (nome, preco)
    SELECT 'Conjunto Lingerie Pink', '149,90'
    WHERE NOT EXISTS (SELECT 1 FROM produtos);
`);

// Rota para ler os produtos do Banco e mandar para a tela
app.get('/api/produtos', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY id ASC');
    res.json(rows);
});

// Rota para o Admin salvar o preço novo
app.post('/api/produtos', async (req, res) => {
    const { id, preco } = req.body;
    await pool.query('UPDATE produtos SET preco = $1 WHERE id = $2', [preco, id]);
    res.json({ sucesso: true });
});

// Liga o servidor
app.listen(process.env.PORT || 8080, () => console.log('Servidor e Banco ON!'));

const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// A parte importante: verificar se a variável existe
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Teste de conexão rápida
pool.connect((err, client, done) => {
  if (err) {
    console.error('Erro ao conectar no banco:', err);
  } else {
    console.log('Banco de dados conectado com sucesso!');
    done();
  }
});

// ... resto do seu código (rotas app.get e app.post)

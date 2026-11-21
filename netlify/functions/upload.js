exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ erro: "Method Not Allowed" }),
    };
  }

  if (!process.env.IMGBB_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        erro: "IMGBB_API_KEY nao configurada nas variaveis de ambiente do Netlify.",
      }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const imagem = body.imagem || body.imageBase64;

    if (!imagem) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ erro: "Nenhuma imagem enviada." }),
      };
    }

    const base64 = imagem.includes(",") ? imagem.split(",")[1] : imagem;

    const params = new URLSearchParams();
    params.append("image", base64);

    const resposta = await fetch(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
      {
        method: "POST",
        body: params,
      }
    );

    const data = await resposta.json();

    if (!data.success) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          erro: data?.error?.message || "Falha no upload da imagem no ImgBB.",
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: data.data.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ erro: err.message }),
    };
  }
};
